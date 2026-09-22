import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { actorFrom } from '../auth.js';
import { issueRef, releaseRefIfLatest } from '../lib/refs.js';
import { buildList, makeFilters } from '../lib/list.js';
import { runWithEvent, entityEvents } from '../lib/mutate.js';
import { createdPayload, enqueueOutbox, enqueueStatusEvents } from '../lib/notify-outbox.js';
import { parseId, assertIn } from '../lib/validate.js';
import { AWAITING_COLLECTION_WHERE, gapColumns } from '../lib/detail-requests.js';
import { enqueueRequestEdited, enqueueDeleted } from '../lib/change-alerts.js';
import { maybeDrawReplacement, recomputeContractStatus, resolveContractLink } from '../lib/contracts.js';
import { attachLot, consignmentNumberColumn, countLotSends, lotSendsColumn, normalizeRef, resolveLot, type Coffee } from '../lib/lots.js';
import { assertConsignment, consignmentWhere } from '../lib/consignments.js';

export const bulkSamples = Router();

const SAMPLE_TYPES = ['offer','type','pss','woc','retention','flavor_mapping','marketing','calibration','other'] as const;
const STATUSES = ['requested','preparing','dispatched','delivered','results_in','cancelled'] as const;
const COURIERS = ['dhl','fedex','ups','rider','hand_delivery','client_pickup','wells_fargo','other'] as const;
const RESULTS = ['approved','rejected','pending_feedback'] as const;

const SORTABLE = ['date_on','delivery_on','qty_grams','moisture_pct','water_activity_num','sample_ref','quality','client','country','status','created_at','sample_type_norm','awb','courier_norm','result_norm','feedback_requested','feedback_received','order_placed','new_sample_requested','new_sample','phyto_cert','blend','rejection_reason','shipment_month','contract_number','location','strategy','highlights','result_on','requested_by','completed_by','stock_grams','dispatched_on','priority','logged_by','tracking_status','tracking_last_event_at','tracking_checked_at','container_no','option_letter','pss_due_date'] as const;

// Contracts + PSS (migration 020): the 45-day deadline lives on the contract, so the book borrows it as
// a SELECT alias — legal in ORDER BY (hence the SORTABLE entry), never in WHERE (hence the EXISTS filters).
const PSS_DUE_SELECT = `(SELECT c.pss_due_date FROM contracts c WHERE c.id = bulk_samples.contract_id) AS pss_due_date`;
// Round 10: how many live sends share this row's ref, and the order (CN number) it belongs to.
const LOT_COLUMNS = `${lotSendsColumn('bulk_samples', 'sample_ref', 'bulk_samples')}, ${consignmentNumberColumn('bulk_samples')}`;

// `sample_type`/`courier_norm` are free text (migration 004) so operators can enter
// values outside COURIERS/SAMPLE_TYPES; those arrays are UI suggestions only.
const createSchema = z.object({
  quality: z.string().min(1),
  client: z.string().min(1),
  sample_type: z.string().default('other'),
  // Optional ISO date override; absent → server defaults to today in Nairobi time. See INSERT below.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  sample_ref: z.string().nullish(),
  bags: z.number().int().nullish(),
  client_ref: z.string().nullish(),
  ico_mark: z.string().nullish(),
  country: z.string().nullish(),
  awb: z.string().nullish(),
  courier_norm: z.string().nullish(),
  qty: z.string().nullish(),
  qty_grams: z.number().int().nullish(),
  moisture: z.string().nullish(),
  water_activity: z.string().nullish(),
  moisture_pct: z.number().nullish(),
  water_activity_num: z.number().nullish(),
  comments: z.string().nullish(),
  crop_year: z.string().nullish(),
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
  // Migration 023 (round 10): the order this send belongs to. 400 when it doesn't exist or is deleted.
  consignment_id: z.string().uuid().nullish(),
});

const patchSchema = z.object({
  status: z.enum(STATUSES).nullish(),
  courier_norm: z.string().nullish(),
  awb: z.string().nullish(),
  result_norm: z.enum(RESULTS).nullish(),
  quality: z.string().nullish(),
  country: z.string().nullish(),
  qty_grams: z.number().int().nullish(),
  client_id: z.string().uuid().nullish(),
  comments: z.string().nullish(),
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

bulkSamples.get('/', h(async (req, res) => {
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
  // Location (free text) — case-insensitive multi, like country.
  if (req.query.location) {
    const values = String(req.query.location).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (values.length) f.add(`lower(location) = ANY (?::text[])`, values);
  }
  if (req.query.shipment_month) f.add(`shipment_month = ?`, String(req.query.shipment_month));
  if (req.query.moisture_min) f.add(`moisture_pct >= ?::numeric`, String(req.query.moisture_min));
  if (req.query.moisture_max) f.add(`moisture_pct <= ?::numeric`, String(req.query.moisture_max));
  if (req.query.water_min) f.add(`water_activity_num >= ?::numeric`, String(req.query.water_min));
  if (req.query.water_max) f.add(`water_activity_num <= ?::numeric`, String(req.query.water_max));
  if (req.query.has_awb === 'true') f.where.push(`awb IS NOT NULL AND awb <> ''`);
  // Low stock (migration 010): lab holds less of the lot than this row needs to send.
  if (req.query.low_stock === 'true') f.where.push(`stock_grams IS NOT NULL AND qty_grams IS NOT NULL AND stock_grams < qty_grams`);
  // Priority (migration 011): ?priority=urgent.
  if (req.query.priority) f.add(`priority = ?`, String(req.query.priority));
  // Log-first (migration 016): rows whose client has no street address on file yet.
  if (req.query.address_missing === 'true') f.where.push('client_address_missing(client_id)');
  // AWB on file, not yet collected by the courier (lifecycle sketch 2026-09-14).
  if (req.query.awaiting_collection === 'true') f.where.push(AWAITING_COLLECTION_WHERE);
  // PSS still owed on a contract whose 45-day deadline has passed (Harriet, round 6).
  if (req.query.pss_overdue === 'true') {
    f.where.push(`sample_type_norm = 'pss' AND result_norm IS DISTINCT FROM 'approved' AND EXISTS (SELECT 1 FROM contracts c WHERE c.id = bulk_samples.contract_id AND c.deleted_at IS NULL AND c.pss_due_date < current_date)`);
  }
  if (req.query.pss_due_within !== undefined) {
    const raw = String(req.query.pss_due_within);
    if (!/^-?\d+$/.test(raw)) throw new HttpError(400, 'invalid pss_due_within');
    f.add(`EXISTS (SELECT 1 FROM contracts c WHERE c.id = bulk_samples.contract_id AND c.deleted_at IS NULL AND c.pss_due_date <= current_date + ?::int)`, Number(raw));
  }
  // Round 10: every send of one coffee (?ref=, exact after normalisation) / of one order (?consignment=).
  if (req.query.ref) f.add(`normalize_ref(sample_ref) = ?`, normalizeRef(String(req.query.ref)));
  if (req.query.consignment) consignmentWhere(f, String(req.query.consignment));
  const result = await buildList(
    { table: 'bulk_samples', extraSelect: `${gapColumns('bulk_samples')}, ${PSS_DUE_SELECT}, ${LOT_COLUMNS}`, sortable: SORTABLE, defaultSort: 'date_on', searchColumns: ['sample_ref','quality','client','country','awb','ico_mark','client_ref','requested_by','logged_by'] },
    req.query, f.where, f.params,
  );
  res.json(result);
}));

bulkSamples.get('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await pool.query(
    `SELECT t.*, ${gapColumns('t')}, ${lotSendsColumn('t', 'sample_ref', 'bulk_samples')},
            c.number AS consignment_number, c.location AS consignment_location
       FROM bulk_samples t LEFT JOIN consignments c ON c.id = t.consignment_id
      WHERE t.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'bulk sample not found');
  res.json({ ...rows[0], events: await entityEvents('bulk', id) });
}));

bulkSamples.post('/', h(async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const actor = actorFrom(req);
  // Auto-issue a Commercial ref when the trader didn't supply one, mirroring specialty-samples.
  // Prefix is chosen from the sample type (pss→SSKE, type→TYPE, else→SL). Feedback ⑱: without this
  // the chaser rendered these rows as "(no ref)" and Chat couldn't resolve them.
  // Auto-link (migration 020/021): a PSS logged with just its contract number finds the contract, the
  // first option slot still free, its option letter and its contract-derived ref (SSKE-<digits><letter>),
  // so nobody has to know contract ids. Non-PSS rows are left alone and take the counter ref.
  let contractId = body.contract_id ?? null;
  let containerNo = body.container_no ?? null;
  let optionLetter: string | null = null;
  let linkedRef: string | null = null;
  if (!contractId) {
    const link = await resolveContractLink(pool, {
      contract_number: body.contract_number, sample_type_norm: body.sample_type, container_no: containerNo,
    });
    contractId = link.contract_id;
    containerNo = link.container_no;
    optionLetter = link.option_letter;
    linkedRef = link.ref;
  }
  // Round 10: the ref names the COFFEE (quality + blend). A typed ref is normalised and checked against its
  // lot before anything is written: same coffee → a re-send on the same ref; different coffee → 409 (the
  // TYPE-113 bug). No typed ref → the counter mints one (even when this coffee already has a ref — the
  // agent's confirm step decides whether to reuse; see POST /lots/resolve).
  const coffee: Coffee = { book: 'commercial', quality: body.quality, blend: body.blend ?? null };
  const typedRef = normalizeRef(body.sample_ref) || null;
  if (typedRef) {
    const r = await resolveLot(pool, { ...coffee, ref: typedRef });
    if (r.action === 'conflict') return res.status(409).json({ error: 'ref_conflict', ref: typedRef, lot: r.lot, sends: r.sends });
  }
  const consignment = body.consignment_id ? await assertConsignment(pool, body.consignment_id) : null;
  const sampleRef = typedRef ?? linkedRef ?? (await issueRef(body.sample_type));
  let reusedRef = false;
  const row = await runWithEvent(
    // date + date_on default to today in Nairobi time when no explicit date is given; $21 overrides.
    `INSERT INTO bulk_samples
       (sample_ref, quality, client, sample_type_norm, bags, client_ref, ico_mark, country, awb,
        courier_norm, qty, qty_grams, moisture, water_activity, moisture_pct, water_activity_num,
        comments, crop_year, client_id, phyto_cert,
        blend, rejection_reason, shipment_month, contract_number, location, strategy, highlights,
        requested_by, stock_grams, priority, logged_by, contract_id, container_no, option_letter, consignment_id, date, date_on, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
             COALESCE($20, (SELECT default_phyto_cert FROM clients WHERE id = $19::uuid)),
             $21,$22,$23,$24,$25,$26,$27,$29,$30,COALESCE($31,'normal'),$32,$33::uuid,$34,$35,$36::uuid,
             COALESCE($28, to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD')),
             COALESCE($28::date, (now() AT TIME ZONE 'Africa/Nairobi')::date),
             'requested')
     RETURNING *`,
    [sampleRef, body.quality, body.client, body.sample_type, body.bags ?? null,
     body.client_ref ?? null, body.ico_mark ?? null, body.country ?? null, body.awb ?? null,
     body.courier_norm ?? null, body.qty ?? null, body.qty_grams ?? null, body.moisture ?? null,
     body.water_activity ?? null, body.moisture_pct ?? null, body.water_activity_num ?? null,
     body.comments ?? null, body.crop_year ?? null, body.client_id ?? null, body.phyto_cert ?? null,
     body.blend ?? null, body.rejection_reason ?? null, body.shipment_month ?? null, body.contract_number ?? null, body.location ?? null,
     body.strategy ?? null, body.highlights ?? null,
     body.date ?? null, body.requested_by ?? null, body.stock_grams ?? null, body.priority ?? null,
     body.logged_by ?? null, contractId, containerNo, optionLetter, consignment?.id ?? null],
    { entityType: 'bulk', type: 'created', note: `${body.quality} for ${body.client}`, actor },
    // Feedback #29: Quality is pinged for every request added in full (create implies the intake gates passed).
    async (client, row) => {
      // The lot rides the insert's transaction: a rolled-back create claims nothing.
      reusedRef = (await attachLot(client, { ...coffee, ref: sampleRef, typed: !!typedRef, createdBy: actor })).reused;
      await enqueueOutbox(client, {
        tab: 'bulk', sampleId: String(row.id), event: 'created', recipient: 'qc',
        payload: await createdPayload(client, row, consignment),
      });
      if (row.contract_id) await recomputeContractStatus(client, String(row.contract_id), actor);
    },
  );
  res.status(201).json({ ...row, lot_sends: await countLotSends(pool, 'bulk_samples', 'sample_ref', sampleRef), reused_ref: reusedRef });
}));

export type BulkPatch = z.infer<typeof patchSchema>;

/**
 * The per-sample PATCH write (one event, status/outbox pings, contract hooks). Exported so an order's
 * dispatch (POST /consignments/:id/dispatch, round 10) applies exactly this to every member.
 */
export async function patchBulkSample(id: string, body: BulkPatch, actor: string): Promise<Record<string, unknown>> {
  const cur = await pool.query(`SELECT * FROM bulk_samples WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!cur.rows[0]) throw new HttpError(404, 'bulk sample not found');
  const prev = cur.rows[0];
  if (Object.keys(body).length === 0) return prev;
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
    `UPDATE bulk_samples SET
       status = COALESCE($2::sample_status_t, status),
       courier_norm = COALESCE($3, courier_norm),
       awb = COALESCE($4, awb),
       result_norm = COALESCE($5::result_t, result_norm),
       quality = COALESCE($6, quality),
       country = COALESCE($7, country),
       qty_grams = COALESCE($8, qty_grams),
       client_id = COALESCE($9::uuid, client_id),
       comments = COALESCE($10, comments),
       feedback_requested = COALESCE($11, feedback_requested),
       feedback_received = COALESCE($12, feedback_received),
       order_placed = COALESCE($13, order_placed),
       new_sample_requested = COALESCE($14, new_sample_requested),
       new_sample = COALESCE($15, new_sample),
       phyto_cert = COALESCE($16, phyto_cert),
       blend = COALESCE($17, blend),
       rejection_reason = COALESCE($18, rejection_reason),
       shipment_month = COALESCE($19, shipment_month),
       contract_number = COALESCE($20, contract_number),
       location = COALESCE($21, location),
       strategy = COALESCE($22, strategy),
       highlights = COALESCE($23, highlights),
       requested_by = COALESCE($24, requested_by),
       completed_by = COALESCE($25, completed_by),
       -- Stock decrement (migration 010): on the transition INTO 'dispatched' (old status differs),
       -- tracked stock drops by the grams sent, floored at 0. NULL stock = not tracked, untouched.
       stock_grams = CASE WHEN $2 = 'dispatched' AND status IS DISTINCT FROM 'dispatched' AND stock_grams IS NOT NULL
                          THEN GREATEST(stock_grams - COALESCE($8, qty_grams, 0), 0)
                          ELSE COALESCE($26, stock_grams) END,
       priority = COALESCE($27, priority),
       logged_by = COALESCE($28, logged_by),
       result_on = CASE WHEN $5 IS NOT NULL AND result_on IS NULL THEN CURRENT_DATE ELSE result_on END,
       delivery_on = CASE WHEN $2 = 'delivered' AND delivery_on IS NULL THEN CURRENT_DATE ELSE delivery_on END,
       -- An explicit dispatched_on edit (feedback #35) wins; else auto-stamp on the dispatch transition.
       dispatched_on = COALESCE($29::date, CASE WHEN $2 = 'dispatched' AND dispatched_on IS NULL THEN CURRENT_DATE ELSE dispatched_on END),
       notify_trader_ids = COALESCE($30::uuid[], notify_trader_ids),
       contract_id = COALESCE($31::uuid, contract_id),
       container_no = COALESCE($32, container_no),
       updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, nextStatus, body.courier_norm ?? null, body.awb ?? null, body.result_norm ?? null,
     body.quality ?? null, body.country ?? null, body.qty_grams ?? null, body.client_id ?? null, body.comments ?? null,
     body.feedback_requested ?? null, body.feedback_received ?? null, body.order_placed ?? null,
     body.new_sample_requested ?? null, body.new_sample ?? null, body.phyto_cert ?? null,
     body.blend ?? null, body.rejection_reason ?? null, body.shipment_month ?? null, body.contract_number ?? null, body.location ?? null,
     body.strategy ?? null, body.highlights ?? null,
     body.requested_by ?? null, body.completed_by ?? null, body.stock_grams ?? null, body.priority ?? null,
     body.logged_by ?? null, body.dispatched_on ?? null, body.notify_trader_ids ?? null,
     body.contract_id ?? null, body.container_no ?? null],
    { entityType: 'bulk', type: eventType, note, actor },
    // Feedback #30: ping the sales trader as the sample progresses (dashboard edits included).
    async (client, row) => {
      await enqueueStatusEvents(client, 'bulk', row, prev, body, nextStatus);
      // Harriet (round 6): QC hears about edits to the request definition by non-QC actors.
      await enqueueRequestEdited(client, 'bulk', prev, row, actor);
      // Contracts + PSS: a first rejection draws its replacement, then the contract re-derives its status.
      out.drawn = (await maybeDrawReplacement(client, 'bulk', row, prev, actor)).drawn;
      // A sample re-pointed to another contract leaves a hole behind: the contract it LEFT re-derives too.
      if (prev.contract_id && String(prev.contract_id) !== String(row.contract_id ?? '')) {
        await recomputeContractStatus(client, String(prev.contract_id), actor);
      }
    },
  );
  if (!row) throw new HttpError(404, 'bulk sample not found');
  // extraWrites returns void, so the replacement's ref reaches the caller through the closure.
  return { ...row, replacement_ref: out.drawn?.sample_ref ?? null };
}

bulkSamples.patch('/:id', h(async (req, res) => {
  res.json(await patchBulkSample(parseId(req.params.id), parseBody(patchSchema, req.body), actorFrom(req)));
}));

bulkSamples.delete('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const actor = actorFrom(req);
  const row = await runWithEvent(
    `UPDATE bulk_samples SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id], { entityType: 'bulk', type: 'deleted', note: 'soft-deleted', actor },
    // Harriet (round 6): every deletion is announced to QC; the row's other pending pings are closed.
    async (client, row) => {
      await enqueueDeleted(client, 'bulk', String(row.id), actor);
      // Harriet (2026-09-10): the ref is reusable when it was the latest number for its prefix.
      await releaseRefIfLatest(client, row.sample_ref as string | null);
      // A deleted PSS leaves its option slot (and letter) free again.
      if (row.contract_id) await recomputeContractStatus(client, String(row.contract_id), actor);
    },
  );
  if (!row) throw new HttpError(404, 'bulk sample not found');
  res.json({ ok: true, id });
}));
