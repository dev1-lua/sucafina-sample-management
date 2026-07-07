import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { actorFrom } from '../auth.js';
import { issueRef } from '../lib/refs.js';
import { addEvent } from '../lib/events.js';

export const samples = Router();

const SAMPLE_TYPES = ['offer','type','pss','woc','retention','flavor_mapping','marketing','calibration','other'] as const;
const STATUSES = ['requested','preparing','dispatched','delivered','results_in','cancelled'] as const;
const COURIERS = ['dhl','fedex','ups','rider','hand_delivery','client_pickup','other'] as const;
const RESULTS = ['approved','rejected','pending_feedback'] as const;

const uuidSchema = z.string().uuid();

function parseId(id: string): string {
  const r = uuidSchema.safeParse(id);
  if (!r.success) throw new HttpError(400, 'invalid id');
  return r.data;
}

const createSchema = z.object({
  ref: z.string().nullish(),
  sample_type: z.enum(SAMPLE_TYPES).default('other'),
  quality: z.string().min(1),
  grade: z.string().nullish(),
  outturn: z.string().nullish(),
  bags: z.number().int().nullish(),
  qty_grams: z.number().int().nullish(),
  client_id: z.string().uuid().nullish(),
  receiver: z.string().min(1),
  requester: z.string().nullish(),
  deadline: z.string().nullish(),
  roast_instructions: z.string().nullish(),
  shipment_month: z.string().nullish(),
  comments: z.string().nullish(),
});

const patchSchema = z.object({
  status: z.enum(STATUSES).nullish(),
  courier: z.enum(COURIERS).nullish(),
  awb: z.string().nullish(),
  result: z.enum(RESULTS).nullish(),
  cupping_notes: z.string().nullish(),
  quality: z.string().nullish(),
  grade: z.string().nullish(),
  qty_grams: z.number().int().nullish(),
  client_id: z.string().uuid().nullish(),
  receiver: z.string().nullish(),
  requester: z.string().nullish(),
  deadline: z.string().nullish(),
  roast_instructions: z.string().nullish(),
  comments: z.string().nullish(),
});

samples.get('/', h(async (req, res) => {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => { params.push(value); where.push(clause.replace('?', `$${params.length}`)); };

  if (req.query.status) {
    add(`status = ANY (?::sample_status_t[])`, String(req.query.status).split(','));
  }
  if (req.query.sample_type) add(`sample_type = ?::sample_type_t`, String(req.query.sample_type));
  if (req.query.client_id) add(`client_id = ?::uuid`, String(req.query.client_id));
  if (req.query.q) {
    add(`(ref ILIKE '%'||?||'%' OR ref_raw ILIKE '%'||$${params.length + 1}||'%' OR quality ILIKE '%'||$${params.length + 1}||'%' OR receiver ILIKE '%'||$${params.length + 1}||'%')`, String(req.query.q));
  }
  if (req.query.overdue === 'true') {
    where.push(`status IN ('requested','preparing') AND (deadline < CURRENT_DATE OR (deadline IS NULL AND coalesce(requested_at, created_at) < now() - interval '3 days'))`);
  }
  if (req.query.awaiting_results === 'true') {
    where.push(`status = 'delivered' AND result IS NULL`);
  }

  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 25)));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const count = await pool.query(`SELECT count(*)::int AS n FROM samples ${whereSql}`, params);
  const { rows } = await pool.query(
    `SELECT * FROM samples ${whereSql}
     ORDER BY coalesce(requested_at, created_at) DESC
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params
  );
  res.json({ data: rows, total: count.rows[0].n, page, pageSize });
}));

samples.post('/', h(async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const actor = actorFrom(req);
  const ref = body.ref ?? (await issueRef(body.sample_type));
  const { rows } = await pool.query(
    `INSERT INTO samples
       (ref, sample_type, quality, grade, outturn, bags, qty_grams, client_id, receiver,
        requester, deadline, roast_instructions, shipment_month, comments, status, requested_at, source_sheet)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'requested', now(), 'agent')
     RETURNING *`,
    [ref, body.sample_type, body.quality, body.grade ?? null, body.outturn ?? null, body.bags ?? null,
     body.qty_grams ?? null, body.client_id ?? null, body.receiver, body.requester ?? null,
     body.deadline ?? null, body.roast_instructions ?? null, body.shipment_month ?? null, body.comments ?? null]
  );
  await addEvent(rows[0].id, 'requested', `${body.quality} for ${body.receiver}${body.requester ? ` (by ${body.requester})` : ''}`, actor);
  res.status(201).json(rows[0]);
}));

samples.get('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await pool.query(`SELECT * FROM samples WHERE id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'sample not found');
  const events = await pool.query(
    `SELECT * FROM sample_events WHERE sample_id = $1 ORDER BY created_at`, [id]);
  res.json({ ...rows[0], events: events.rows });
}));

samples.get('/:id/events', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await pool.query(
    `SELECT * FROM sample_events WHERE sample_id = $1 ORDER BY created_at`, [id]);
  res.json({ data: rows });
}));

samples.patch('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const body = parseBody(patchSchema, req.body);
  const actor = actorFrom(req);
  const cur = await pool.query(`SELECT * FROM samples WHERE id = $1`, [id]);
  if (!cur.rows[0]) throw new HttpError(404, 'sample not found');
  const prev = cur.rows[0];

  // result implies results_in
  const nextStatus = body.result ? 'results_in' : body.status ?? null;

  const { rows } = await pool.query(
    `UPDATE samples SET
       status = COALESCE($2::sample_status_t, status),
       courier = COALESCE($3::courier_t, courier),
       awb = COALESCE($4, awb),
       result = COALESCE($5::result_t, result),
       cupping_notes = COALESCE($6, cupping_notes),
       quality = COALESCE($7, quality),
       grade = COALESCE($8, grade),
       qty_grams = COALESCE($9, qty_grams),
       client_id = COALESCE($10::uuid, client_id),
       receiver = COALESCE($11, receiver),
       requester = COALESCE($12, requester),
       deadline = COALESCE($13::date, deadline),
       roast_instructions = COALESCE($14, roast_instructions),
       comments = COALESCE($15, comments),
       dispatched_at = CASE WHEN $2 = 'dispatched' AND dispatched_at IS NULL THEN now() ELSE dispatched_at END,
       delivered_at  = CASE WHEN $2 = 'delivered'  AND delivered_at  IS NULL THEN now() ELSE delivered_at END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, nextStatus, body.courier ?? null, body.awb ?? null, body.result ?? null,
     body.cupping_notes ?? null, body.quality ?? null, body.grade ?? null, body.qty_grams ?? null,
     body.client_id ?? null, body.receiver ?? null, body.requester ?? null, body.deadline ?? null,
     body.roast_instructions ?? null, body.comments ?? null]
  );

  const eventType =
    body.status === 'dispatched' ? 'dispatched'
    : body.result ? 'result_logged'
    : nextStatus && nextStatus !== prev.status ? 'status_change'
    : 'edited';
  const note =
    eventType === 'dispatched' ? `via ${body.courier ?? prev.courier ?? '?'} AWB ${body.awb ?? prev.awb ?? '—'}`
    : eventType === 'result_logged' ? `${body.result}${body.cupping_notes ? `: ${body.cupping_notes}` : ''}`
    : eventType === 'status_change' ? `${prev.status} → ${nextStatus}`
    : `fields updated: ${Object.keys(body).join(', ')}`;
  await addEvent(id, eventType, note, actor);
  res.json(rows[0]);
}));
