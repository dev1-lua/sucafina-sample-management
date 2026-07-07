import { Router } from 'express';
import { pool } from '../db.js';
import { h, HttpError } from '../errors.js';
import { actorFrom } from '../auth.js';
import { computeDigest } from '../lib/digest.js';
import { addEvent } from '../lib/events.js';

export const chaser = Router();

chaser.post('/run', h(async (req, res) => {
  const digest = await computeDigest();
  await pool.query(`INSERT INTO chaser_digests (payload) VALUES ($1)`, [JSON.stringify(digest)]);
  const actor = actorFrom(req) === 'api' ? 'job:chaser' : actorFrom(req);
  for (const [name, b] of Object.entries(digest.buckets)) {
    for (const item of b.items) {
      await addEvent(String(item.id), 'chased', `flagged in digest bucket: ${name}`, actor);
    }
  }
  res.json(digest);
}));

chaser.get('/digest', h(async (_req, res) => {
  const { rows } = await pool.query(`SELECT payload FROM chaser_digests ORDER BY created_at DESC LIMIT 1`);
  if (!rows[0]) throw new HttpError(404, 'no digest yet');
  res.json(rows[0].payload);
}));
