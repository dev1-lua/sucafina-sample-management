import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { actorFrom } from '../auth.js';
import { buildList, makeFilters } from '../lib/list.js';
import { runWithEvent, entityEvents } from '../lib/mutate.js';
import { parseId, assertIn } from '../lib/validate.js';

export const forwardingSamples = Router();

const STATUSES = ['requested','preparing','dispatched','delivered','cancelled'] as const; // no results_in
const COURIERS = ['dhl','fedex','ups','rider','hand_delivery','client_pickup','other'] as const;
const SORTABLE = ['date_on','qty_grams','sample_ref','sender','origin','receiver_company','id_number','status','created_at','coffee_quality','awb','courier_norm','feedback_requested','feedback_received','order_placed','new_sample_requested','new_sample'] as const;

// `courier_norm` is free text (migration 004) so operators can enter values outside
// COURIERS; that array is a UI suggestion list only.
const createSchema = z.object({
  sender: z.string().min(1),
  origin: z.string().min(1),
  sample_ref: z.string().min(1),
  coffee_quality: z.string().min(1),
  receiver_company: z.string().min(1),
  // Optional ISO date override; absent → server defaults to today in Nairobi time. See INSERT below.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  id_number: z.string().nullish(),  // nullable + not unique (verbatim fidelity)
  awb: z.string().nullish(),
  courier_norm: z.string().nullish(),
  qty: z.string().nullish(),
  qty_grams: z.number().int().nullish(),
  client_id: z.string().uuid().nullish(),
});

const patchSchema = z.object({
  status: z.enum(STATUSES).nullish(),
  courier_norm: z.string().nullish(),
  awb: z.string().nullish(),
  id_number: z.string().nullish(),
  receiver_company: z.string().nullish(),
  qty_grams: z.number().int().nullish(),
  client_id: z.string().uuid().nullish(),
  // Free-form chaser follow-up fields (migration 004): "Yes"/"No", a date, or free text.
  feedback_requested: z.string().nullish(),
  feedback_received: z.string().nullish(),
  order_placed: z.string().nullish(),
  new_sample_requested: z.string().nullish(),
  new_sample: z.string().nullish(),
});

forwardingSamples.get('/', h(async (req, res) => {
  const f = makeFilters();
  if (req.query.status) {
    const values = String(req.query.status).split(',');
    for (const v of values) assertIn(v, STATUSES, 'status');
    f.add(`status = ANY (?::sample_status_t[])`, values);
  }
  if (req.query.courier_norm) {
    const values = String(req.query.courier_norm).split(',');
    for (const v of values) assertIn(v, COURIERS, 'courier_norm');
    f.add(`courier_norm = ANY (?::text[])`, values);
  }
  if (req.query.origin) f.add(`origin = ?`, String(req.query.origin));
  if (req.query.sender) f.add(`sender = ?`, String(req.query.sender));
  if (req.query.client_id) f.add(`client_id = ?::uuid`, String(req.query.client_id));
  if (req.query.date_from) f.add(`date_on >= ?::date`, String(req.query.date_from));
  if (req.query.date_to) f.add(`date_on <= ?::date`, String(req.query.date_to));
  if (req.query.has_awb === 'true') f.where.push(`awb IS NOT NULL AND awb <> ''`);
  if (req.query.has_id === 'true') f.where.push(`id_number IS NOT NULL AND id_number <> ''`);
  if (req.query.has_id === 'false') f.where.push(`(id_number IS NULL OR id_number = '')`);
  const result = await buildList(
    { table: 'forwarding_samples', sortable: SORTABLE, defaultSort: 'date_on', searchColumns: ['sample_ref','coffee_quality','receiver_company','sender','origin','id_number','awb'] },
    req.query, f.where, f.params,
  );
  res.json(result);
}));

forwardingSamples.get('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await pool.query(`SELECT * FROM forwarding_samples WHERE id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'forwarding sample not found');
  res.json({ ...rows[0], events: await entityEvents('forwarding', id) });
}));

forwardingSamples.post('/', h(async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const actor = actorFrom(req);
  const status = body.awb || body.courier_norm ? 'dispatched' : 'requested';
  const row = await runWithEvent(
    // date + date_on default to today in Nairobi time when no explicit date is given; $13 overrides.
    `INSERT INTO forwarding_samples
       (sender, origin, sample_ref, coffee_quality, receiver_company, id_number, awb, courier_norm,
        qty, qty_grams, client_id, date, date_on, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
             COALESCE($13, to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD')),
             COALESCE($13::date, (now() AT TIME ZONE 'Africa/Nairobi')::date),
             $12::sample_status_t)
     RETURNING *`,
    [body.sender, body.origin, body.sample_ref, body.coffee_quality, body.receiver_company,
     body.id_number ?? null, body.awb ?? null, body.courier_norm ?? null, body.qty ?? null,
     body.qty_grams ?? null, body.client_id ?? null, status, body.date ?? null],
    { entityType: 'forwarding', type: 'created', note: `${body.sample_ref} from ${body.origin} → ${body.receiver_company}`, actor },
  );
  res.status(201).json(row);
}));

forwardingSamples.patch('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const body = parseBody(patchSchema, req.body);
  const actor = actorFrom(req);
  const cur = await pool.query(`SELECT * FROM forwarding_samples WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!cur.rows[0]) throw new HttpError(404, 'forwarding sample not found');
  const prev = cur.rows[0];
  if (Object.keys(body).length === 0) return res.json(prev);
  const nextStatus = body.status ?? null; // NEVER results_in

  const eventType =
    body.status === 'dispatched' ? 'dispatched'
    : body.status === 'delivered' ? 'delivery_update'
    : nextStatus && nextStatus !== prev.status ? 'status_change'
    : 'edited';
  const note =
    eventType === 'dispatched' ? `via ${body.courier_norm ?? prev.courier_norm ?? '?'} AWB ${body.awb ?? prev.awb ?? '—'}`
    : eventType === 'delivery_update' ? 'delivered'
    : eventType === 'status_change' ? `${prev.status} → ${nextStatus}`
    : `fields updated: ${Object.keys(body).join(', ')}`;

  const row = await runWithEvent(
    `UPDATE forwarding_samples SET
       status = COALESCE($2::sample_status_t, status),
       courier_norm = COALESCE($3, courier_norm),
       awb = COALESCE($4, awb),
       id_number = COALESCE($5, id_number),
       receiver_company = COALESCE($6, receiver_company),
       qty_grams = COALESCE($7, qty_grams),
       client_id = COALESCE($8::uuid, client_id),
       feedback_requested = COALESCE($9, feedback_requested),
       feedback_received = COALESCE($10, feedback_received),
       order_placed = COALESCE($11, order_placed),
       new_sample_requested = COALESCE($12, new_sample_requested),
       new_sample = COALESCE($13, new_sample),
       updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, nextStatus, body.courier_norm ?? null, body.awb ?? null, body.id_number ?? null,
     body.receiver_company ?? null, body.qty_grams ?? null, body.client_id ?? null,
     body.feedback_requested ?? null, body.feedback_received ?? null, body.order_placed ?? null,
     body.new_sample_requested ?? null, body.new_sample ?? null],
    { entityType: 'forwarding', type: eventType, note, actor },
  );
  if (!row) throw new HttpError(404, 'forwarding sample not found');
  res.json(row);
}));

forwardingSamples.delete('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const actor = actorFrom(req);
  const row = await runWithEvent(
    `UPDATE forwarding_samples SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id], { entityType: 'forwarding', type: 'deleted', note: 'soft-deleted', actor },
  );
  if (!row) throw new HttpError(404, 'forwarding sample not found');
  res.json({ ok: true, id });
}));
