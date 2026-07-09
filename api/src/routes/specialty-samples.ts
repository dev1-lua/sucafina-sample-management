import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { actorFrom } from '../auth.js';
import { issueRef } from '../lib/refs.js';
import { buildList, makeFilters } from '../lib/list.js';
import { runWithEvent, entityEvents } from '../lib/mutate.js';
import { parseId, assertIn } from '../lib/validate.js';

export const specialtySamples = Router();

const SAMPLE_TYPES = ['offer','type','pss','woc','retention','flavor_mapping','marketing','calibration','other'] as const;
const STATUSES = ['requested','preparing','dispatched','delivered','results_in','cancelled'] as const;
const COURIERS = ['dhl','fedex','ups','rider','hand_delivery','client_pickup','other'] as const;
const RESULTS = ['approved','rejected','pending_feedback'] as const;

const SORTABLE = ['date_on','delivery_on','qty_grams','ref','description','receiver_company','status','created_at','name','grade','awb','courier_norm','result_norm','country','feedback_requested','feedback_received','order_placed','new_sample_requested','new_sample'] as const;

// `sample_type_norm`/`courier_norm` are free text (migration 004) so operators can
// enter values outside COURIERS/SAMPLE_TYPES; those arrays are UI suggestions only.
const createSchema = z.object({
  description: z.string().min(1),
  receiver_company: z.string().min(1),
  sample_type_norm: z.string().default('other'),
  // Optional ISO date override; absent → server defaults to today in Nairobi time
  // (the future MS-Teams-sourced-date seam). See INSERT below.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  ref: z.string().nullish(),
  outturn: z.string().nullish(),
  name: z.string().nullish(),
  grade: z.string().nullish(),
  bags: z.number().int().nullish(),
  awb: z.string().nullish(),
  courier_norm: z.string().nullish(),
  qty: z.string().nullish(),
  qty_grams: z.number().int().nullish(),
  comments: z.string().nullish(),
  crop_year: z.string().nullish(),
  country: z.string().nullish(),
  client_id: z.string().uuid().nullish(),
});

const patchSchema = z.object({
  status: z.enum(STATUSES).nullish(),
  courier_norm: z.string().nullish(),
  awb: z.string().nullish(),
  result_norm: z.enum(RESULTS).nullish(),
  description: z.string().nullish(),
  grade: z.string().nullish(),
  qty_grams: z.number().int().nullish(),
  client_id: z.string().uuid().nullish(),
  receiver_company: z.string().nullish(),
  comments: z.string().nullish(),
  country: z.string().nullish(),
  // Free-form chaser follow-up fields (migration 004): "Yes"/"No", a date, or free text.
  feedback_requested: z.string().nullish(),
  feedback_received: z.string().nullish(),
  order_placed: z.string().nullish(),
  new_sample_requested: z.string().nullish(),
  new_sample: z.string().nullish(),
});

specialtySamples.get('/', h(async (req, res) => {
  const f = makeFilters();
  if (req.query.status) {
    const values = String(req.query.status).split(',');
    for (const v of values) assertIn(v, STATUSES, 'status');
    f.add(`status = ANY (?::sample_status_t[])`, values);
  }
  if (req.query.sample_type_norm) {
    const values = String(req.query.sample_type_norm).split(',');
    for (const v of values) assertIn(v, SAMPLE_TYPES, 'sample_type_norm');
    f.add(`sample_type_norm = ANY (?::text[])`, values);
  }
  if (req.query.courier_norm) {
    const values = String(req.query.courier_norm).split(',');
    for (const v of values) assertIn(v, COURIERS, 'courier_norm');
    f.add(`courier_norm = ANY (?::text[])`, values);
  }
  if (req.query.result_norm) {
    const values = String(req.query.result_norm).split(',');
    for (const v of values) assertIn(v, RESULTS, 'result_norm');
    f.add(`result_norm = ANY (?::result_t[])`, values);
  }
  // Country: case-insensitive + multi (BELGIUM/Belgium/belgium all match).
  if (req.query.country) {
    const values = String(req.query.country).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (values.length) f.add(`lower(country) = ANY (?::text[])`, values);
  }
  if (req.query.client_id) f.add(`client_id = ?::uuid`, String(req.query.client_id));
  if (req.query.date_from) f.add(`date_on >= ?::date`, String(req.query.date_from));
  if (req.query.date_to) f.add(`date_on <= ?::date`, String(req.query.date_to));
  if (req.query.has_awb === 'true') f.where.push(`awb IS NOT NULL AND awb <> ''`);
  const result = await buildList(
    { table: 'specialty_samples', sortable: SORTABLE, defaultSort: 'date_on', searchColumns: ['ref','description','receiver_company','name','awb'] },
    req.query, f.where, f.params,
  );
  res.json(result);
}));

specialtySamples.get('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await pool.query(`SELECT * FROM specialty_samples WHERE id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'specialty sample not found');
  res.json({ ...rows[0], events: await entityEvents('specialty', id) });
}));

specialtySamples.post('/', h(async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const actor = actorFrom(req);
  const ref = body.ref ?? (await issueRef(body.sample_type_norm));
  const row = await runWithEvent(
    // date (verbatim text, shown in the dashboard's Date column) and date_on (typed, sorted on)
    // both default to today in Nairobi time when no explicit date is given; $17 supplies an override.
    `INSERT INTO specialty_samples
       (ref, description, receiver_company, sample_type_norm, outturn, name, grade, bags,
        awb, courier_norm, qty, qty_grams, comments, crop_year, client_id, country, date, date_on, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
             COALESCE($17, to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD')),
             COALESCE($17::date, (now() AT TIME ZONE 'Africa/Nairobi')::date),
             'requested')
     RETURNING *`,
    [ref, body.description, body.receiver_company, body.sample_type_norm, body.outturn ?? null,
     body.name ?? null, body.grade ?? null, body.bags ?? null, body.awb ?? null, body.courier_norm ?? null,
     body.qty ?? null, body.qty_grams ?? null, body.comments ?? null, body.crop_year ?? null, body.client_id ?? null,
     body.country ?? null, body.date ?? null],
    { entityType: 'specialty', type: 'created', note: `${body.description} for ${body.receiver_company}`, actor },
  );
  res.status(201).json(row);
}));

specialtySamples.patch('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const body = parseBody(patchSchema, req.body);
  const actor = actorFrom(req);
  const cur = await pool.query(`SELECT * FROM specialty_samples WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!cur.rows[0]) throw new HttpError(404, 'specialty sample not found');
  const prev = cur.rows[0];
  if (Object.keys(body).length === 0) return res.json(prev);
  const nextStatus = body.result_norm ? 'results_in' : body.status ?? null;

  const eventType =
    body.status === 'dispatched' ? 'dispatched'
    : body.result_norm ? 'result_logged'
    : nextStatus && nextStatus !== prev.status ? 'status_change'
    : 'edited';
  const note =
    eventType === 'dispatched' ? `via ${body.courier_norm ?? prev.courier_norm ?? '?'} AWB ${body.awb ?? prev.awb ?? '—'}`
    : eventType === 'result_logged' ? String(body.result_norm)
    : eventType === 'status_change' ? `${prev.status} → ${nextStatus}`
    : `fields updated: ${Object.keys(body).join(', ')}`;

  const row = await runWithEvent(
    `UPDATE specialty_samples SET
       status = COALESCE($2::sample_status_t, status),
       courier_norm = COALESCE($3, courier_norm),
       awb = COALESCE($4, awb),
       result_norm = COALESCE($5::result_t, result_norm),
       description = COALESCE($6, description),
       grade = COALESCE($7, grade),
       qty_grams = COALESCE($8, qty_grams),
       client_id = COALESCE($9::uuid, client_id),
       receiver_company = COALESCE($10, receiver_company),
       comments = COALESCE($11, comments),
       country = COALESCE($12, country),
       feedback_requested = COALESCE($13, feedback_requested),
       feedback_received = COALESCE($14, feedback_received),
       order_placed = COALESCE($15, order_placed),
       new_sample_requested = COALESCE($16, new_sample_requested),
       new_sample = COALESCE($17, new_sample),
       delivery_on = CASE WHEN $2 = 'delivered' AND delivery_on IS NULL THEN CURRENT_DATE ELSE delivery_on END,
       updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, nextStatus, body.courier_norm ?? null, body.awb ?? null, body.result_norm ?? null,
     body.description ?? null, body.grade ?? null, body.qty_grams ?? null, body.client_id ?? null,
     body.receiver_company ?? null, body.comments ?? null, body.country ?? null,
     body.feedback_requested ?? null, body.feedback_received ?? null, body.order_placed ?? null,
     body.new_sample_requested ?? null, body.new_sample ?? null],
    { entityType: 'specialty', type: eventType, note, actor },
  );
  if (!row) throw new HttpError(404, 'specialty sample not found');
  res.json(row);
}));

specialtySamples.delete('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const actor = actorFrom(req);
  const row = await runWithEvent(
    `UPDATE specialty_samples SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id], { entityType: 'specialty', type: 'deleted', note: 'soft-deleted', actor },
  );
  if (!row) throw new HttpError(404, 'specialty sample not found');
  res.json({ ok: true, id });
}));
