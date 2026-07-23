import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { z } from 'zod';
import { actorFrom } from '../auth.js';
import { issueConsignmentNumber } from '../lib/refs.js';
import { runWithEvent, entityEvents } from '../lib/mutate.js';
import { parseId, clampInt } from '../lib/validate.js';

export const consignments = Router();

const TABS = ['specialty', 'bulk', 'forwarding'] as const;
const TABLE: Record<(typeof TABS)[number], string> = {
  specialty: 'specialty_samples',
  bulk: 'bulk_samples',
  forwarding: 'forwarding_samples',
};

// Live member count summed across the three sample tables (soft-deleted rows excluded).
const MEMBER_COUNT = `
  (SELECT count(*) FROM specialty_samples s  WHERE s.consignment_id  = c.id AND s.deleted_at  IS NULL)
+ (SELECT count(*) FROM bulk_samples b       WHERE b.consignment_id  = c.id AND b.deleted_at  IS NULL)
+ (SELECT count(*) FROM forwarding_samples f WHERE f.consignment_id  = c.id AND f.deleted_at  IS NULL)`;

const createSchema = z.object({
  location: z.string().nullish(),
  status: z.string().nullish(),
  notes: z.string().nullish(),
});
const patchSchema = z.object({
  location: z.string().nullish(),
  status: z.string().nullish(),
  notes: z.string().nullish(),
});
// Add/remove a batch of samples from one book to/from the consignment.
const membersSchema = z.object({
  tab: z.enum(TABS),
  ids: z.array(z.string().uuid()).min(1),
});

consignments.get('/', h(async (req, res) => {
  const where: string[] = ['c.deleted_at IS NULL'];
  const params: unknown[] = [];
  const q = String(req.query.q ?? '').trim();
  if (q) {
    params.push(q);
    where.push(`(c.number ILIKE '%'||$${params.length}||'%' OR c.location ILIKE '%'||$${params.length}||'%')`);
  }
  if (req.query.location) {
    params.push(String(req.query.location).toLowerCase());
    where.push(`lower(c.location) = $${params.length}`);
  }
  if (req.query.status) {
    params.push(String(req.query.status));
    where.push(`c.status = $${params.length}`);
  }
  const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clampInt(req.query.pageSize, 25, 1, 100);
  const { rows } = await pool.query(
    `SELECT c.*, (${MEMBER_COUNT})::int AS member_count, count(*) OVER()::int AS full_count
       FROM consignments c
      WHERE ${where.join(' AND ')}
      ORDER BY c.created_at DESC, c.id ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params,
  );
  const total = rows[0]?.full_count ?? 0;
  res.json({ data: rows.map(({ full_count, ...r }) => r), total, page, pageSize });
}));

consignments.get('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await pool.query(
    `SELECT c.*, (${MEMBER_COUNT})::int AS member_count FROM consignments c WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'consignment not found');
  // Member samples across the three books, in one unified shape.
  const members = await pool.query(
    `SELECT 'specialty' AS tab, id, ref AS ref, description AS title, receiver_company AS receiver, status, location
       FROM specialty_samples  WHERE consignment_id = $1 AND deleted_at IS NULL
     UNION ALL
     SELECT 'bulk', id, sample_ref, quality, client, status, location
       FROM bulk_samples       WHERE consignment_id = $1 AND deleted_at IS NULL
     UNION ALL
     SELECT 'forwarding', id, sample_ref, coffee_quality, receiver_company, status, location
       FROM forwarding_samples WHERE consignment_id = $1 AND deleted_at IS NULL
     ORDER BY tab, ref`,
    [id],
  );
  res.json({ ...rows[0], members: members.rows, events: await entityEvents('consignment', id) });
}));

consignments.post('/', h(async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const actor = actorFrom(req);
  const number = await issueConsignmentNumber();
  const row = await runWithEvent(
    `INSERT INTO consignments (number, location, status, notes)
     VALUES ($1, $2, COALESCE($3, 'open'), $4) RETURNING *`,
    [number, body.location ?? null, body.status ?? null, body.notes ?? null],
    { entityType: 'consignment', type: 'created', note: `consignment ${number}`, actor },
  );
  res.status(201).json(row);
}));

consignments.patch('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const body = parseBody(patchSchema, req.body);
  const actor = actorFrom(req);
  const cur = await pool.query(`SELECT * FROM consignments WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!cur.rows[0]) throw new HttpError(404, 'consignment not found');
  if (Object.keys(body).length === 0) return res.json(cur.rows[0]);
  const row = await runWithEvent(
    `UPDATE consignments SET
       location = COALESCE($2, location),
       status   = COALESCE($3, status),
       notes    = COALESCE($4, notes),
       updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, body.location ?? null, body.status ?? null, body.notes ?? null],
    { entityType: 'consignment', type: 'edited', note: `fields updated: ${Object.keys(body).join(', ')}`, actor },
  );
  if (!row) throw new HttpError(404, 'consignment not found');
  res.json(row);
}));

// Attach samples (one book at a time) to this consignment.
consignments.post('/:id/samples', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { tab, ids } = parseBody(membersSchema, req.body);
  const actor = actorFrom(req);
  const c = await pool.query(`SELECT id, number FROM consignments WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!c.rows[0]) throw new HttpError(404, 'consignment not found');
  const upd = await pool.query(
    `UPDATE ${TABLE[tab]} SET consignment_id = $1, updated_at = now()
      WHERE id = ANY($2::uuid[]) AND deleted_at IS NULL RETURNING id`,
    [id, ids],
  );
  await pool.query(
    `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('consignment', $1, 'edited', $2, $3)`,
    [id, `added ${upd.rowCount} ${tab} sample(s)`, actor],
  );
  res.json({ ok: true, added: upd.rowCount, ids: upd.rows.map((r) => r.id) });
}));

// Detach samples from this consignment (clears their consignment_id).
consignments.delete('/:id/samples', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { tab, ids } = parseBody(membersSchema, req.body);
  const actor = actorFrom(req);
  const upd = await pool.query(
    `UPDATE ${TABLE[tab]} SET consignment_id = NULL, updated_at = now()
      WHERE id = ANY($2::uuid[]) AND consignment_id = $1 RETURNING id`,
    [id, ids],
  );
  await pool.query(
    `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('consignment', $1, 'edited', $2, $3)`,
    [id, `removed ${upd.rowCount} ${tab} sample(s)`, actor],
  );
  res.json({ ok: true, removed: upd.rowCount, ids: upd.rows.map((r) => r.id) });
}));

consignments.delete('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const actor = actorFrom(req);
  const row = await runWithEvent(
    `UPDATE consignments SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id], { entityType: 'consignment', type: 'deleted', note: 'soft-deleted', actor },
  );
  if (!row) throw new HttpError(404, 'consignment not found');
  // Detach members so they're free to regroup (the consignment row is kept for audit).
  for (const t of TABS) {
    await pool.query(`UPDATE ${TABLE[t]} SET consignment_id = NULL WHERE consignment_id = $1`, [id]);
  }
  res.json({ ok: true, id });
}));
