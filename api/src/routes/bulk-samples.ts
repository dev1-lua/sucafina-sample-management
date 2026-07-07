import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { actorFrom } from '../auth.js';
import { buildList, makeFilters } from '../lib/list.js';
import { runWithEvent, entityEvents } from '../lib/mutate.js';
import { parseId } from '../lib/validate.js';

export const bulkSamples = Router();

const SAMPLE_TYPES = ['offer','type','pss','woc','retention','flavor_mapping','marketing','calibration','other'] as const;
const STATUSES = ['requested','preparing','dispatched','delivered','results_in','cancelled'] as const;
const COURIERS = ['dhl','fedex','ups','rider','hand_delivery','client_pickup','other'] as const;
const RESULTS = ['approved','rejected','pending_feedback'] as const;

const SORTABLE = ['date_on','delivery_on','qty_grams','moisture_pct','water_activity_num','sample_ref','quality','client','country','status','created_at'] as const;

const createSchema = z.object({
  quality: z.string().min(1),
  client: z.string().min(1),
  sample_type: z.enum(SAMPLE_TYPES).default('other'),
  sample_ref: z.string().nullish(),
  bags: z.number().int().nullish(),
  client_ref: z.string().nullish(),
  ico_mark: z.string().nullish(),
  country: z.string().nullish(),
  awb: z.string().nullish(),
  courier_norm: z.enum(COURIERS).nullish(),
  qty: z.string().nullish(),
  qty_grams: z.number().int().nullish(),
  moisture: z.string().nullish(),
  water_activity: z.string().nullish(),
  moisture_pct: z.number().nullish(),
  water_activity_num: z.number().nullish(),
  comments: z.string().nullish(),
  crop_year: z.string().nullish(),
  client_id: z.string().uuid().nullish(),
});

const patchSchema = z.object({
  status: z.enum(STATUSES).nullish(),
  courier_norm: z.enum(COURIERS).nullish(),
  awb: z.string().nullish(),
  result_norm: z.enum(RESULTS).nullish(),
  quality: z.string().nullish(),
  country: z.string().nullish(),
  qty_grams: z.number().int().nullish(),
  client_id: z.string().uuid().nullish(),
  comments: z.string().nullish(),
});

bulkSamples.get('/', h(async (req, res) => {
  const f = makeFilters();
  if (req.query.status) f.add(`status = ANY (?::sample_status_t[])`, String(req.query.status).split(','));
  if (req.query.sample_type_norm) f.add(`sample_type_norm = ?::sample_type_t`, String(req.query.sample_type_norm));
  if (req.query.courier_norm) f.add(`courier_norm = ?::courier_t`, String(req.query.courier_norm));
  if (req.query.result_norm) f.add(`result_norm = ?::result_t`, String(req.query.result_norm));
  if (req.query.country) f.add(`country = ?`, String(req.query.country));
  if (req.query.client_id) f.add(`client_id = ?::uuid`, String(req.query.client_id));
  if (req.query.date_from) f.add(`date_on >= ?::date`, String(req.query.date_from));
  if (req.query.date_to) f.add(`date_on <= ?::date`, String(req.query.date_to));
  if (req.query.moisture_min) f.add(`moisture_pct >= ?::numeric`, String(req.query.moisture_min));
  if (req.query.moisture_max) f.add(`moisture_pct <= ?::numeric`, String(req.query.moisture_max));
  if (req.query.water_min) f.add(`water_activity_num >= ?::numeric`, String(req.query.water_min));
  if (req.query.water_max) f.add(`water_activity_num <= ?::numeric`, String(req.query.water_max));
  if (req.query.has_awb === 'true') f.where.push(`awb IS NOT NULL AND awb <> ''`);
  const result = await buildList(
    { table: 'bulk_samples', sortable: SORTABLE, defaultSort: 'date_on', searchColumns: ['sample_ref','quality','client','country','awb','ico_mark','client_ref'] },
    req.query, f.where, f.params,
  );
  res.json(result);
}));

bulkSamples.get('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await pool.query(`SELECT * FROM bulk_samples WHERE id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'bulk sample not found');
  res.json({ ...rows[0], events: await entityEvents('bulk', id) });
}));

bulkSamples.post('/', h(async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const actor = actorFrom(req);
  const row = await runWithEvent(
    `INSERT INTO bulk_samples
       (sample_ref, quality, client, sample_type_norm, bags, client_ref, ico_mark, country, awb,
        courier_norm, qty, qty_grams, moisture, water_activity, moisture_pct, water_activity_num,
        comments, crop_year, client_id, status)
     VALUES ($1,$2,$3,$4::sample_type_t,$5,$6,$7,$8,$9,$10::courier_t,$11,$12,$13,$14,$15,$16,$17,$18,$19,'requested')
     RETURNING *`,
    [body.sample_ref ?? null, body.quality, body.client, body.sample_type, body.bags ?? null,
     body.client_ref ?? null, body.ico_mark ?? null, body.country ?? null, body.awb ?? null,
     body.courier_norm ?? null, body.qty ?? null, body.qty_grams ?? null, body.moisture ?? null,
     body.water_activity ?? null, body.moisture_pct ?? null, body.water_activity_num ?? null,
     body.comments ?? null, body.crop_year ?? null, body.client_id ?? null],
    { entityType: 'bulk', type: 'created', note: `${body.quality} for ${body.client}`, actor },
  );
  res.status(201).json(row);
}));

bulkSamples.patch('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const body = parseBody(patchSchema, req.body);
  const actor = actorFrom(req);
  const cur = await pool.query(`SELECT * FROM bulk_samples WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!cur.rows[0]) throw new HttpError(404, 'bulk sample not found');
  const prev = cur.rows[0];
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
    `UPDATE bulk_samples SET
       status = COALESCE($2::sample_status_t, status),
       courier_norm = COALESCE($3::courier_t, courier_norm),
       awb = COALESCE($4, awb),
       result_norm = COALESCE($5::result_t, result_norm),
       quality = COALESCE($6, quality),
       country = COALESCE($7, country),
       qty_grams = COALESCE($8, qty_grams),
       client_id = COALESCE($9::uuid, client_id),
       comments = COALESCE($10, comments),
       delivery_on = CASE WHEN $2 = 'delivered' AND delivery_on IS NULL THEN CURRENT_DATE ELSE delivery_on END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, nextStatus, body.courier_norm ?? null, body.awb ?? null, body.result_norm ?? null,
     body.quality ?? null, body.country ?? null, body.qty_grams ?? null, body.client_id ?? null, body.comments ?? null],
    { entityType: 'bulk', type: eventType, note, actor },
  );
  res.json(row);
}));

bulkSamples.delete('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const actor = actorFrom(req);
  const row = await runWithEvent(
    `UPDATE bulk_samples SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id], { entityType: 'bulk', type: 'deleted', note: 'soft-deleted', actor },
  );
  if (!row) throw new HttpError(404, 'bulk sample not found');
  res.json({ ok: true, id });
}));
