import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { actorFrom } from '../auth.js';
import { issueRef } from '../lib/refs.js';
import { buildList, makeFilters } from '../lib/list.js';
import { runWithEvent, entityEvents } from '../lib/mutate.js';
import { enqueueOutbox, enqueueStatusEvents } from '../lib/notify-outbox.js';
import { parseId, assertIn } from '../lib/validate.js';
import { gapColumns } from '../lib/detail-requests.js';
import { enqueueRequestEdited, enqueueDeleted } from '../lib/change-alerts.js';
import { maybeDrawReplacement, recomputeContractStatus, resolveContractLink } from '../lib/contracts.js';

export const specialtySamples = Router();

const SAMPLE_TYPES = ['offer','type','pss','woc','retention','flavor_mapping','marketing','calibration','other'] as const;
const STATUSES = ['requested','preparing','dispatched','delivered','results_in','cancelled'] as const;
const COURIERS = ['dhl','fedex','ups','rider','hand_delivery','client_pickup','wells_fargo','other'] as const;
const RESULTS = ['approved','rejected','pending_feedback'] as const;

const SORTABLE = ['date_on','delivery_on','qty_grams','ref','description','receiver_company','status','created_at','name','grade','awb','courier_norm','result_norm','country','feedback_requested','feedback_received','order_placed','new_sample_requested','new_sample','phyto_cert','blend','rejection_reason','shipment_month','contract_number','location','strategy','highlights','result_on','requested_by','completed_by','stock_grams','dispatched_on','priority','logged_by','tracking_status','tracking_last_event_at','tracking_checked_at'] as const;

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
  // Phytosanitary certificate needed? (migration 005): "Yes"/"No"/"Client to confirm" or free text.
  phyto_cert: z.string().nullish(),
  // New per-sample fields (migration 007). All optional free text.
  blend: z.string().nullish(),
  rejection_reason: z.string().nullish(),
  shipment_month: z.string().nullish(),
  contract_number: z.string().nullish(),
  location: z.string().nullish(),
  // Approved-sample attributes (migration 009, feedback ⑬).
  strategy: z.string().nullish(),
  highlights: z.string().nullish(),
  // Migration 010: who placed the request (Sales Trader), and grams of the lot held at the lab.
  requested_by: z.string().nullish(),
  stock_grams: z.number().int().nullish(),
  // Migration 011 (feedback #25): urgency flag — 'normal' | 'urgent'.
  priority: z.enum(['normal', 'urgent']).nullish(),
  // Migration 013 (feedback #28): who typed the request into the bot (agent auto-stamps).
  logged_by: z.string().nullish(),
  // Migration 020: a pre-shipment sample belongs to one container of one contract. Absent on a PSS with a
  // contract_number, both are resolved below.
  contract_id: z.string().uuid().nullish(),
  container_no: z.number().int().min(1).nullish(),
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
  phyto_cert: z.string().nullish(),
  // New per-sample fields (migration 007).
  blend: z.string().nullish(),
  rejection_reason: z.string().nullish(),
  shipment_month: z.string().nullish(),
  contract_number: z.string().nullish(),
  location: z.string().nullish(),
  // Approved-sample attributes (migration 009).
  strategy: z.string().nullish(),
  highlights: z.string().nullish(),
  // Migration 010.
  requested_by: z.string().nullish(),
  completed_by: z.string().nullish(),
  stock_grams: z.number().int().nullish(),
  // Migration 011 (feedback #25): urgency flag — 'normal' | 'urgent'.
  priority: z.enum(['normal', 'urgent']).nullish(),
  // Migration 013 (feedback #28).
  logged_by: z.string().nullish(),
  // Feedback #35 (Brillian): the dispatch date is editable after the fact.
  dispatched_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').nullish(),
  // Migration 014 (feedback #34): extra people kept in the loop on this sample (traders ids). Replaces the list.
  notify_trader_ids: z.array(z.string().uuid()).max(20).nullish(),
  // Migration 020: contract + container this PSS belongs to.
  contract_id: z.string().uuid().nullish(),
  container_no: z.number().int().min(1).nullish(),
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
  // Location (free text) — case-insensitive multi, like country.
  if (req.query.location) {
    const values = String(req.query.location).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (values.length) f.add(`lower(location) = ANY (?::text[])`, values);
  }
  if (req.query.shipment_month) f.add(`shipment_month = ?`, String(req.query.shipment_month));
  // Low stock (migration 010): lab holds less of the lot than this row needs to send.
  if (req.query.low_stock === 'true') f.where.push(`stock_grams IS NOT NULL AND qty_grams IS NOT NULL AND stock_grams < qty_grams`);
  // Priority (migration 011): ?priority=urgent.
  if (req.query.priority) f.add(`priority = ?`, String(req.query.priority));
  // Log-first (migration 016): rows whose client has no street address on file yet.
  if (req.query.address_missing === 'true') f.where.push('client_address_missing(client_id)');
  const result = await buildList(
    { table: 'specialty_samples', extraSelect: gapColumns('specialty_samples'), sortable: SORTABLE, defaultSort: 'date_on', searchColumns: ['ref','description','receiver_company','name','awb','requested_by','logged_by'] },
    req.query, f.where, f.params,
  );
  res.json(result);
}));

specialtySamples.get('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await pool.query(
    `SELECT t.*, ${gapColumns('t')}, c.number AS consignment_number, c.location AS consignment_location
       FROM specialty_samples t LEFT JOIN consignments c ON c.id = t.consignment_id
      WHERE t.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'specialty sample not found');
  res.json({ ...rows[0], events: await entityEvents('specialty', id) });
}));

specialtySamples.post('/', h(async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const actor = actorFrom(req);
  const ref = body.ref ?? (await issueRef(body.sample_type_norm));
  // Auto-link (migration 020): a PSS logged with just its contract number finds the contract and the
  // first container still without one. Non-PSS rows are left alone.
  let contractId = body.contract_id ?? null;
  let containerNo = body.container_no ?? null;
  if (!contractId) {
    const link = await resolveContractLink(pool, {
      contract_number: body.contract_number, sample_type_norm: body.sample_type_norm, container_no: containerNo,
    });
    contractId = link.contract_id;
    containerNo = link.container_no;
  }
  const row = await runWithEvent(
    // date (verbatim text, shown in the dashboard's Date column) and date_on (typed, sorted on)
    // both default to today in Nairobi time when no explicit date is given; $18 supplies an override.
    `INSERT INTO specialty_samples
       (ref, description, receiver_company, sample_type_norm, outturn, name, grade, bags,
        awb, courier_norm, qty, qty_grams, comments, crop_year, client_id, country, phyto_cert,
        blend, rejection_reason, shipment_month, contract_number, location, strategy, highlights,
        requested_by, stock_grams, priority, logged_by, contract_id, container_no, date, date_on, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
             COALESCE($17, (SELECT default_phyto_cert FROM clients WHERE id = $15::uuid)),
             $18,$19,$20,$21,$22,$23,$24,$26,$27,COALESCE($28,'normal'),$29,$30::uuid,$31,
             COALESCE($25, to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD')),
             COALESCE($25::date, (now() AT TIME ZONE 'Africa/Nairobi')::date),
             'requested')
     RETURNING *`,
    [ref, body.description, body.receiver_company, body.sample_type_norm, body.outturn ?? null,
     body.name ?? null, body.grade ?? null, body.bags ?? null, body.awb ?? null, body.courier_norm ?? null,
     body.qty ?? null, body.qty_grams ?? null, body.comments ?? null, body.crop_year ?? null, body.client_id ?? null,
     body.country ?? null, body.phyto_cert ?? null,
     body.blend ?? null, body.rejection_reason ?? null, body.shipment_month ?? null, body.contract_number ?? null, body.location ?? null,
     body.strategy ?? null, body.highlights ?? null,
     body.date ?? null, body.requested_by ?? null, body.stock_grams ?? null, body.priority ?? null,
     body.logged_by ?? null, contractId, containerNo],
    { entityType: 'specialty', type: 'created', note: `${body.description} for ${body.receiver_company}`, actor },
    // Feedback #29: Quality is pinged for every request added in full (create implies the intake gates passed).
    async (client, row) => {
      await enqueueOutbox(client, { tab: 'specialty', sampleId: String(row.id), event: 'created', recipient: 'qc' });
      if (row.contract_id) await recomputeContractStatus(client, String(row.contract_id), actor);
    },
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

  const out: { drawn: { id: string; sample_ref: string } | null } = { drawn: null };
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
       phyto_cert = COALESCE($18, phyto_cert),
       blend = COALESCE($19, blend),
       rejection_reason = COALESCE($20, rejection_reason),
       shipment_month = COALESCE($21, shipment_month),
       contract_number = COALESCE($22, contract_number),
       location = COALESCE($23, location),
       strategy = COALESCE($24, strategy),
       highlights = COALESCE($25, highlights),
       requested_by = COALESCE($26, requested_by),
       completed_by = COALESCE($27, completed_by),
       -- Stock decrement (migration 010): on the transition INTO 'dispatched' (old status differs),
       -- tracked stock drops by the grams sent, floored at 0. NULL stock = not tracked, untouched.
       stock_grams = CASE WHEN $2 = 'dispatched' AND status IS DISTINCT FROM 'dispatched' AND stock_grams IS NOT NULL
                          THEN GREATEST(stock_grams - COALESCE($8, qty_grams, 0), 0)
                          ELSE COALESCE($28, stock_grams) END,
       priority = COALESCE($29, priority),
       logged_by = COALESCE($30, logged_by),
       result_on = CASE WHEN $5 IS NOT NULL AND result_on IS NULL THEN CURRENT_DATE ELSE result_on END,
       delivery_on = CASE WHEN $2 = 'delivered' AND delivery_on IS NULL THEN CURRENT_DATE ELSE delivery_on END,
       -- An explicit dispatched_on edit (feedback #35) wins; else auto-stamp on the dispatch transition.
       dispatched_on = COALESCE($31::date, CASE WHEN $2 = 'dispatched' AND dispatched_on IS NULL THEN CURRENT_DATE ELSE dispatched_on END),
       notify_trader_ids = COALESCE($32::uuid[], notify_trader_ids),
       contract_id = COALESCE($33::uuid, contract_id),
       container_no = COALESCE($34, container_no),
       updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, nextStatus, body.courier_norm ?? null, body.awb ?? null, body.result_norm ?? null,
     body.description ?? null, body.grade ?? null, body.qty_grams ?? null, body.client_id ?? null,
     body.receiver_company ?? null, body.comments ?? null, body.country ?? null,
     body.feedback_requested ?? null, body.feedback_received ?? null, body.order_placed ?? null,
     body.new_sample_requested ?? null, body.new_sample ?? null, body.phyto_cert ?? null,
     body.blend ?? null, body.rejection_reason ?? null, body.shipment_month ?? null, body.contract_number ?? null, body.location ?? null,
     body.strategy ?? null, body.highlights ?? null,
     body.requested_by ?? null, body.completed_by ?? null, body.stock_grams ?? null, body.priority ?? null,
     body.logged_by ?? null, body.dispatched_on ?? null, body.notify_trader_ids ?? null,
     body.contract_id ?? null, body.container_no ?? null],
    { entityType: 'specialty', type: eventType, note, actor },
    // Feedback #30: ping the sales trader as the sample progresses (dashboard edits included).
    async (client, row) => {
      await enqueueStatusEvents(client, 'specialty', row, prev, body, nextStatus);
      // Harriet (round 6): QC hears about edits to the request definition by non-QC actors.
      await enqueueRequestEdited(client, 'specialty', prev, row, actor);
      // Contracts + PSS: a first rejection draws its replacement, then the contract re-derives its status.
      out.drawn = (await maybeDrawReplacement(client, 'specialty', row, prev, actor)).drawn;
    },
  );
  if (!row) throw new HttpError(404, 'specialty sample not found');
  // extraWrites returns void, so the replacement's ref reaches the caller through the closure.
  res.json({ ...row, replacement_ref: out.drawn?.sample_ref ?? null });
}));

specialtySamples.delete('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const actor = actorFrom(req);
  const row = await runWithEvent(
    `UPDATE specialty_samples SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id], { entityType: 'specialty', type: 'deleted', note: 'soft-deleted', actor },
    // Harriet (round 6): every deletion is announced to QC; the row's other pending pings are closed.
    async (client, row) => {
      await enqueueDeleted(client, 'specialty', String(row.id), actor);
      // A deleted PSS leaves its container empty again.
      if (row.contract_id) await recomputeContractStatus(client, String(row.contract_id), actor);
    },
  );
  if (!row) throw new HttpError(404, 'specialty sample not found');
  res.json({ ok: true, id });
}));
