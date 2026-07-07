import { Router } from 'express';
import { pool } from '../db.js';
import { h, HttpError } from '../errors.js';
import { actorFrom } from '../auth.js';
import { computeDigest } from '../lib/digest.js';
import { runWithEvent, type EntityType } from '../lib/mutate.js';

export const chaser = Router();

const TAB_TO_ENTITY: Record<string, EntityType> = { specialty: 'specialty', bulk: 'bulk', forwarding: 'forwarding' };
const TAB_TO_TABLE: Record<string, string> = {
  specialty: 'specialty_samples', bulk: 'bulk_samples', forwarding: 'forwarding_samples',
};

chaser.post('/run', h(async (req, res) => {
  const digest = await computeDigest();
  await pool.query(`INSERT INTO chaser_digests (payload) VALUES ($1)`, [JSON.stringify(digest)]);
  const actor = actorFrom(req) === 'api' ? 'job:chaser' : actorFrom(req);
  for (const [name, b] of Object.entries(digest.buckets)) {
    for (const item of b.items) {
      const entityType = TAB_TO_ENTITY[item.tab];
      const table = TAB_TO_TABLE[item.tab];
      if (!entityType || !table) continue;
      // touch updated_at so the change + event go through the audited single-writer path
      await runWithEvent(
        `UPDATE ${table} SET updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [item.id], { entityType, type: 'chased', note: `flagged in digest bucket: ${name}`, actor },
      );
    }
  }
  res.json(digest);
}));

chaser.get('/digest', h(async (_req, res) => {
  const { rows } = await pool.query(`SELECT payload FROM chaser_digests ORDER BY created_at DESC LIMIT 1`);
  if (!rows[0]) throw new HttpError(404, 'no digest yet');
  res.json(rows[0].payload);
}));
