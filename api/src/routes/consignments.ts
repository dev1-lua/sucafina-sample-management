import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { z } from 'zod';
import { actorFrom } from '../auth.js';
import { parseActor } from '../lib/actor.js';
import { issueConsignmentNumber } from '../lib/refs.js';
import { runWithEvent, entityEvents } from '../lib/mutate.js';
import { enqueueDeleted } from '../lib/change-alerts.js';
import { parseId, clampInt } from '../lib/validate.js';
import { DERIVED_STATUS, MEMBER_COUNT, TABLE, TABS, attachSamples, detachAll, detachSamples, memberRows, type Tab } from '../lib/consignments.js';
import { patchBulkSample } from './bulk-samples.js';
import { patchSpecialtySample } from './specialty-samples.js';
import { patchForwardingSample } from './forwarding-samples.js';

// Consignments (migration 008) are, since round 10 (migration 023), the ORDER: one request, one client,
// several sends. The row carries who asked / who logged it; derived_status is read off the members.

export const consignments = Router();

const createSchema = z.object({
  location: z.string().nullish(),
  status: z.string().nullish(),
  notes: z.string().nullish(),
  client_id: z.string().uuid().nullish(),
  requested_by: z.string().nullish(),
  logged_by: z.string().nullish(),
  samples: z.array(z.object({ tab: z.enum(TABS), id: z.string().uuid() })).max(200).nullish(),
});
const patchSchema = z.object({
  location: z.string().nullish(),
  status: z.string().nullish(),
  notes: z.string().nullish(),
  client_id: z.string().uuid().nullish(),
  requested_by: z.string().nullish(),
  logged_by: z.string().nullish(),
});
// Add/remove a batch of samples from one book to/from the consignment.
const membersSchema = z.object({
  tab: z.enum(TABS),
  ids: z.array(z.string().uuid()).min(1),
});
const dispatchSchema = z.object({
  courier: z.string().min(1),
  awb: z.string().min(1),
  dispatched_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').nullish(),
});

// ?book= takes the lot vocabulary too: the Commercial book is the bulk tab/table.
const BOOK_TAB: Record<string, Tab> = { specialty: 'specialty', bulk: 'bulk', commercial: 'bulk', forwarding: 'forwarding' };

const SELECT = `c.*, cl.name AS client_name, (${MEMBER_COUNT})::int AS member_count, ${DERIVED_STATUS} AS derived_status`;
const FROM = `FROM consignments c LEFT JOIN clients cl ON cl.id = c.client_id`;

consignments.get('/', h(async (req, res) => {
  const where: string[] = ['c.deleted_at IS NULL'];
  const params: unknown[] = [];
  const q = String(req.query.q ?? '').trim();
  if (q) {
    params.push(q);
    where.push(`(c.number ILIKE '%'||$${params.length}||'%' OR c.location ILIKE '%'||$${params.length}||'%' OR cl.name ILIKE '%'||$${params.length}||'%')`);
  }
  if (req.query.location) {
    params.push(String(req.query.location).toLowerCase());
    where.push(`lower(c.location) = $${params.length}`);
  }
  if (req.query.status) {
    params.push(String(req.query.status));
    where.push(`c.status = $${params.length}`);
  }
  if (req.query.client_id) {
    params.push(parseId(String(req.query.client_id)));
    where.push(`c.client_id = $${params.length}`);
  }
  if (req.query.book) {
    const tab = BOOK_TAB[String(req.query.book)];
    if (!tab) throw new HttpError(400, 'invalid book');
    // At least one live member from that book.
    where.push(`EXISTS (SELECT 1 FROM ${TABLE[tab]} m WHERE m.consignment_id = c.id AND m.deleted_at IS NULL)`);
  }
  const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clampInt(req.query.pageSize, 25, 1, 100);
  const { rows } = await pool.query(
    `SELECT ${SELECT}, count(*) OVER()::int AS full_count
       ${FROM}
      WHERE ${where.join(' AND ')}
      ORDER BY c.created_at DESC, c.id ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params,
  );
  const total = rows[0]?.full_count ?? 0;
  res.json({ data: rows.map(({ full_count, ...r }) => r), total, page, pageSize });
}));

async function loadConsignment(id: string) {
  const { rows } = await pool.query(`SELECT ${SELECT} ${FROM} WHERE c.id = $1 AND c.deleted_at IS NULL`, [id]);
  if (!rows[0]) throw new HttpError(404, 'consignment not found');
  return rows[0];
}

consignments.get('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const row = await loadConsignment(id);
  res.json({ ...row, members: await memberRows(pool, id), events: await entityEvents('consignment', id) });
}));

consignments.post('/', h(async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const actor = actorFrom(req);
  if (body.client_id) {
    const { rows } = await pool.query(`SELECT 1 FROM clients WHERE id = $1 AND deleted_at IS NULL`, [body.client_id]);
    if (!rows[0]) throw new HttpError(400, 'client not found');
  }
  const number = await issueConsignmentNumber();
  const row = await runWithEvent(
    `INSERT INTO consignments (number, location, status, notes, client_id, requested_by, logged_by)
     VALUES ($1, $2, COALESCE($3, 'open'), $4, $5::uuid, $6, $7) RETURNING *`,
    [number, body.location ?? null, body.status ?? null, body.notes ?? null,
     body.client_id ?? null, body.requested_by ?? null, body.logged_by ?? null],
    { entityType: 'consignment', type: 'created', note: `consignment ${number}`, actor },
    // The order's samples are attached on the same transaction (contracts §6).
    async (client, row) => {
      const byTab = new Map<Tab, string[]>();
      for (const s of body.samples ?? []) byTab.set(s.tab, [...(byTab.get(s.tab) ?? []), s.id]);
      for (const [tab, ids] of byTab) await attachSamples(client, { id: String(row.id), number }, tab, ids, actor);
    },
  );
  if (!row) throw new HttpError(500, 'consignment not created');
  const { rows } = await pool.query(`SELECT (${MEMBER_COUNT})::int AS member_count FROM consignments c WHERE c.id = $1`, [row.id]);
  res.status(201).json({ ...row, member_count: rows[0].member_count });
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
       client_id    = COALESCE($5::uuid, client_id),
       requested_by = COALESCE($6, requested_by),
       logged_by    = COALESCE($7, logged_by),
       updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, body.location ?? null, body.status ?? null, body.notes ?? null,
     body.client_id ?? null, body.requested_by ?? null, body.logged_by ?? null],
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
  const attached = await attachSamples(pool, { id, number: String(c.rows[0].number) }, tab, ids, actor);
  res.json({ ok: true, added: attached.length, ids: attached });
}));

// Detach samples from this consignment (clears their consignment_id).
consignments.delete('/:id/samples', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { tab, ids } = parseBody(membersSchema, req.body);
  const detached = await detachSamples(pool, id, tab, ids, actorFrom(req));
  res.json({ ok: true, removed: detached.length, ids: detached });
}));

const PATCH_BY_TAB = { specialty: patchSpecialtySample, bulk: patchBulkSample, forwarding: patchForwardingSample } as const;

/**
 * Dispatch the whole order (round 10, contracts §6): the per-sample PATCH write — status, courier, AWB,
 * dispatched_on, stock decrement, completed_by, one event and the outbox pings — applied to every live,
 * non-cancelled member. Each member is its own transaction, exactly as the dashboard's per-row PATCH is.
 */
consignments.post('/:id/dispatch', h(async (req, res) => {
  const id = parseId(req.params.id);
  const body = parseBody(dispatchSchema, req.body);
  const actor = actorFrom(req);
  const c = await pool.query(`SELECT id, number, status FROM consignments WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!c.rows[0]) throw new HttpError(404, 'consignment not found');
  const patch = {
    status: 'dispatched' as const, courier_norm: body.courier, awb: body.awb,
    dispatched_on: body.dispatched_on ?? null, completed_by: parseActor(actor).name,
  };
  let updated = 0;
  for (const m of await memberRows(pool, id)) {
    if (m.status === 'cancelled') continue;
    await PATCH_BY_TAB[m.tab](m.id, patch, actor);
    updated += 1;
  }
  await runWithEvent(
    `UPDATE consignments SET status = CASE WHEN status = 'open' THEN 'dispatched' ELSE status END, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id],
    { entityType: 'consignment', type: 'dispatched', note: `${updated} sample(s) via ${body.courier} AWB ${body.awb}`, actor },
  );
  res.json({ updated });
}));

consignments.delete('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const actor = actorFrom(req);
  const row = await runWithEvent(
    `UPDATE consignments SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id], { entityType: 'consignment', type: 'deleted', note: 'soft-deleted', actor },
    // Members are detached on the same transaction so they're free to regroup (the row is kept for audit),
    // and the order comes off their still-pending created pings.
    async (db, row) => {
      await enqueueDeleted(db, 'consignment', String(row.id), actor);
      await detachAll(db, String(row.id));
    },
  );
  if (!row) throw new HttpError(404, 'consignment not found');
  res.json({ ok: true, id });
}));
