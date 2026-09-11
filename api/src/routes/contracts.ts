import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { actorFrom } from '../auth.js';
import { buildList, makeFilters } from '../lib/list.js';
import { runWithEvent, entityEvents } from '../lib/mutate.js';
import { enqueueOutbox } from '../lib/notify-outbox.js';
import { enqueueDeleted } from '../lib/change-alerts.js';
import { parseId, assertIn, clampInt } from '../lib/validate.js';
import {
  containerStates, drawPss, firstFreeContainer, loadContractPss, nextOptionLetters, pssStageLabel,
  recomputeContractStatus, usedOptionLetters, SETTLED_STATUSES, type ContractStatus, type PssRow,
} from '../lib/contracts.js';

export const contracts = Router();

// Contracts + pre-shipment samples (migration 020 — Harriet, round 6). A contract ships N containers
// and owes one PSS per container 45 days before shipment (pss_due_date, generated). Verdicts on those
// samples drive the contract's status through api/src/lib/contracts.ts; nothing here decides it by hand
// except the two manual states below.

const STATUSES = ['open','pss_pending','pss_partial','pss_replacement_rejected','pss_approved','shipped','cancelled'] as const;
// A contract in one of these is done with PSS: no reminders, no recompute.
const SETTLED = `(${SETTLED_STATUSES.map((s) => `'${s}'`).join(',')})`;

/**
 * Per-container roll-up for one contract row, as JSON: expected / approved / rejected / pending.
 * Must agree with containerStates()/containerState() in lib/contracts.ts, so it obeys the same two rules:
 *   • only containers 1..pss_expected count — a PSS with no container_no (every container taken when it
 *     was logged) or one past the expected count is shown separately, never in these numbers;
 *   • every container lands in exactly ONE bucket — approved wins (an approval ends the container even
 *     after rejections), then failed (rejected twice, never approved), and the rest are still pending.
 * `alias` is the contracts alias in the enclosing query — the subquery correlates on it.
 */
const pssCounts = (alias: string) => `(
    SELECT json_build_object(
             'expected', ${alias}.pss_expected,
             'approved', count(*) FILTER (WHERE s.approved),
             'rejected', count(*) FILTER (WHERE s.rejections >= 2 AND NOT s.approved),
             'pending',  ${alias}.pss_expected
                         - count(*) FILTER (WHERE s.approved)
                         - count(*) FILTER (WHERE s.rejections >= 2 AND NOT s.approved))
      FROM (SELECT u.container_no,
                   COALESCE(bool_or(u.result_norm = 'approved'), false) AS approved,
                   count(*) FILTER (WHERE u.result_norm = 'rejected') AS rejections
              FROM (SELECT container_no, result_norm FROM bulk_samples
                     WHERE contract_id = ${alias}.id AND sample_type_norm = 'pss' AND deleted_at IS NULL AND status <> 'cancelled'
                    UNION ALL
                    SELECT container_no, result_norm FROM specialty_samples
                     WHERE contract_id = ${alias}.id AND sample_type_norm = 'pss' AND deleted_at IS NULL AND status <> 'cancelled') u
             WHERE u.container_no BETWEEN 1 AND ${alias}.pss_expected
             GROUP BY u.container_no) s) AS pss_counts`;

type PssCounts = { expected: number; approved: number; rejected: number; pending: number };

const createSchema = z.object({
  contract_number: z.string().min(1),
  client_id: z.string().uuid().nullish(),
  client_name: z.string().nullish(),
  quality: z.string().nullish(),
  destination: z.string().nullish(),
  shipment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').nullish(),
  shipment_month: z.string().nullish(),
  // Capped: create_pss draws one PSS per container inside a single transaction, so an absurd count
  // would hold that transaction (and a block of SSKE refs) open. No real contract is near 50.
  containers: z.number().int().min(1).max(50).default(1),
  // Harriet (2026-09-10): the number of lettered PSS options — free of the container count.
  pss_expected: z.number().int().min(1).max(50).nullish(),
  // The client's PO reference (JDE: "a PSS per PO") and the grams per option (CK 500 g, Zoegas 600 g…).
  po_ref: z.string().trim().max(120).nullish(),
  pss_qty_grams: z.number().int().min(1).max(50000).nullish(),
  notes: z.string().nullish(),
  // Draw the whole set of PSS requests up front (the dashboard's "create + draw" path).
  create_pss: z.boolean().nullish(),
});

const patchSchema = z.object({
  contract_number: z.string().min(1).nullish(),
  client_id: z.string().uuid().nullish(),
  client_name: z.string().nullish(),
  quality: z.string().nullish(),
  destination: z.string().nullish(),
  shipment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').nullish(),
  shipment_month: z.string().nullish(),
  containers: z.number().int().min(1).max(50).nullish(),
  pss_expected: z.number().int().min(1).max(50).nullish(),
  po_ref: z.string().trim().max(120).nullish(),
  pss_qty_grams: z.number().int().min(1).max(50000).nullish(),
  notes: z.string().nullish(),
  // Only the states a human owns: the PSS ones are derived. 'open' hands the contract back to the machine.
  status: z.enum(['shipped', 'cancelled', 'open']).nullish(),
});

const drawSchema = z.object({ container_no: z.number().int().min(1) });
const linkSchema = z.object({
  tab: z.enum(['specialty', 'bulk']),
  sample_id: z.string().uuid(),
  container_no: z.number().int().min(1).nullish(),
});

contracts.get('/', h(async (req, res) => {
  const f = makeFilters();
  if (req.query.status) {
    const values = String(req.query.status).split(',');
    for (const v of values) assertIn(v, STATUSES, 'status');
    f.add(`status = ANY (?::text[])`, values);
  }
  if (req.query.client_id) f.add(`client_id = ?::uuid`, String(req.query.client_id));
  if (req.query.due_before) f.add(`pss_due_date <= ?::date`, String(req.query.due_before));
  if (req.query.overdue === 'true') f.where.push(`pss_due_date < current_date AND status NOT IN ${SETTLED}`);
  const result = await buildList(
    {
      table: 'contracts', extraSelect: pssCounts('contracts'),
      sortable: ['pss_due_date','shipment_date','contract_number','client_name','status','created_at','containers'],
      defaultSort: 'pss_due_date', defaultOrder: 'asc',
      searchColumns: ['contract_number','client_name','quality','destination'],
    },
    req.query, f.where, f.params,
  );
  res.json(result);
}));

// ---- the 45-day rule: what is due, and the sweep that says so -------------------------------------
// Both declared before '/:id' so Express does not read "pss-due" as a contract id.

const DUE_POOL = `FROM contracts c
      WHERE c.deleted_at IS NULL AND c.pss_due_date IS NOT NULL AND c.status NOT IN ${SETTLED}`;

contracts.get('/pss-due', h(async (req, res) => {
  const days = clampInt(req.query.days, 14, 0, 365);
  const { rows } = await pool.query(
    `SELECT c.*, ${pssCounts('c')} ${DUE_POOL} AND c.pss_due_date <= current_date + $1::int
      ORDER BY c.pss_due_date, c.contract_number`,
    [days],
  );
  const items = rows.map((r) => ({
    ...r,
    missing_pss: Math.max((r.pss_counts as PssCounts).expected - (r.pss_counts as PssCounts).approved, 0),
  }));
  res.json({ count: items.length, items });
}));

/**
 * The agent's daily nudge. D-14 / D-7 / D-0 fire once each (dedupe key 'D14'…); an overdue contract is
 * repeated once a WEEK (ISO week key) until its PSS land, so a missed shipment cannot go quiet. Contracts
 * whose containers are all approved are skipped — there is nothing left to chase. One transaction.
 */
contracts.post('/pss-sweep', h(async (req, res) => {
  const actor = actorFrom(req);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT c.*, (c.pss_due_date - current_date) AS days_left,
              to_char(current_date, 'IYYY-"W"IW') AS week_key, ${pssCounts('c')}
       ${DUE_POOL} ORDER BY c.pss_due_date, c.contract_number`,
    );
    let dueSoon = 0;
    let overdue = 0;
    for (const r of rows) {
      const counts = r.pss_counts as PssCounts;
      const missing = counts.expected - counts.approved;
      if (missing <= 0) continue;
      const daysLeft = Number(r.days_left);
      const payload = {
        contract_number: r.contract_number, client_name: r.client_name,
        shipment_date: r.shipment_date, pss_due_date: r.pss_due_date,
        days_left: daysLeft, missing_pss: missing, approved: counts.approved, expected: counts.expected,
      };
      // The counts are rows actually QUEUED, not contracts looked at: a second pass the same day
      // dedupes into nothing and must report {0, 0} so the job can say "nothing new to send".
      if (daysLeft === 14 || daysLeft === 7 || daysLeft === 0) {
        const queued = await enqueueOutbox(client, {
          tab: 'contract', sampleId: String(r.id), event: 'pss_due_soon', recipient: 'qc',
          dedupeKey: `D${daysLeft}`, payload, actor,
        });
        if (queued) dueSoon++;
      } else if (daysLeft < 0) {
        const queued = await enqueueOutbox(client, {
          tab: 'contract', sampleId: String(r.id), event: 'pss_overdue', recipient: 'qc',
          dedupeKey: String(r.week_key), payload: { ...payload, overdue_days: -daysLeft }, actor,
        });
        if (queued) overdue++;
      }
    }
    await client.query('COMMIT');
    client.release();
    res.json({ due_soon: dueSoon, overdue });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    client.release(e as Error);
    throw e;
  }
}));

contracts.get('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await pool.query(
    `SELECT c.*, ${pssCounts('c')},
            (SELECT json_build_object('id', cl.id, 'name', cl.name,
                      'account_owner', (SELECT json_build_object('id', tr.id, 'name', tr.name, 'email', tr.email)
                                          FROM traders tr WHERE tr.id = cl.account_owner_id AND tr.active))
               FROM clients cl WHERE cl.id = c.client_id AND cl.deleted_at IS NULL) AS client
       FROM contracts c WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new HttpError(404, 'contract not found');
  const pssRows = await loadContractPss(pool, id);
  // Every row carries Harriet's stage wording ("Pending PSS dispatch", "Pending replacement results"…).
  const staged = (r: PssRow) => ({ ...r, stage: pssStageLabel(r) });
  const containers = containerStates(pssRows, row.pss_expected).map((c) => ({ ...c, samples: c.samples.map(staged) }));
  // Anything the slots did not claim (no container_no, or one past pss_expected) is still shown.
  const claimed = new Set(containers.flatMap((c) => c.samples.map((s) => s.id)));
  res.json({
    ...row,
    client: row.client ?? null,
    containers,
    unassigned: pssRows.filter((r) => !claimed.has(r.id)).map(staged),
    events: await entityEvents('contract', id),
  });
}));

contracts.post('/', h(async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const actor = actorFrom(req);
  const number = body.contract_number.trim();
  // The partial unique index is the backstop; this check makes the collision a 409 instead of a 500.
  const dup = await pool.query(
    `SELECT id FROM contracts WHERE upper(trim(contract_number)) = upper($1) AND deleted_at IS NULL`,
    [number.toUpperCase()],
  );
  if (dup.rows[0]) throw new HttpError(409, `contract ${number} already exists`);
  // SQL cannot default one column to another, so pss_expected mirrors containers here.
  const pssExpected = body.pss_expected ?? body.containers;
  const clientName = body.client_name ?? (body.client_id
    ? (await pool.query(`SELECT name FROM clients WHERE id = $1`, [body.client_id])).rows[0]?.name ?? null
    : null);
  const out: { status: ContractStatus | null } = { status: null };
  const row = await runWithEvent<Record<string, unknown>>(
    `INSERT INTO contracts (contract_number, client_id, client_name, quality, destination,
                            shipment_date, shipment_month, containers, pss_expected, notes, source, po_ref, pss_qty_grams)
     VALUES ($1,$2::uuid,$3,$4,$5,$6::date,$7,$8,$9,$10,'manual',$11,$12) RETURNING *`,
    [number, body.client_id ?? null, clientName, body.quality ?? null, body.destination ?? null,
     body.shipment_date ?? null, body.shipment_month ?? null, body.containers, pssExpected, body.notes ?? null,
     body.po_ref || null, body.pss_qty_grams ?? null],
    { entityType: 'contract', type: 'created', note: `contract ${number}${clientName ? ` for ${clientName}` : ''}`, actor },
    async (client, created) => {
      if (body.create_pss) {
        for (let n = 1; n <= pssExpected; n++) {
          await drawPss(client, { contractId: String(created.id), containerNo: n, actor });
        }
      }
      out.status = (await recomputeContractStatus(client, String(created.id), actor)).status;
    },
  );
  res.status(201).json({ ...row, status: out.status ?? row!.status });
}));

contracts.patch('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const body = parseBody(patchSchema, req.body);
  const actor = actorFrom(req);
  const cur = await pool.query(`SELECT * FROM contracts WHERE id = $1 AND deleted_at IS NULL`, [id]);
  const prev = cur.rows[0];
  if (!prev) throw new HttpError(404, 'contract not found');
  if (Object.keys(body).length === 0) return res.json(prev);
  // Renaming onto a number another live contract already holds is a conflict, not a crash
  // (the partial unique index is still the backstop — errorHandler maps 23505 to 409 too).
  if (body.contract_number) {
    const dup = await pool.query(
      `SELECT id FROM contracts
        WHERE upper(trim(contract_number)) = upper(trim($1)) AND deleted_at IS NULL AND id <> $2`,
      [body.contract_number, id],
    );
    if (dup.rows[0]) throw new HttpError(409, `contract ${body.contract_number.trim()} already exists`);
  }
  const statusChange = body.status != null && body.status !== prev.status;
  const out: { status: ContractStatus | null } = { status: null };
  const row = await runWithEvent<Record<string, unknown>>(
    `UPDATE contracts SET
       contract_number = COALESCE($2, contract_number),
       client_id       = COALESCE($3::uuid, client_id),
       client_name     = COALESCE($4, client_name),
       quality         = COALESCE($5, quality),
       destination     = COALESCE($6, destination),
       shipment_date   = COALESCE($7::date, shipment_date),
       shipment_month  = COALESCE($8, shipment_month),
       containers      = COALESCE($9, containers),
       pss_expected    = COALESCE($10, pss_expected),
       notes           = COALESCE($11, notes),
       status          = COALESCE($12, status),
       po_ref          = COALESCE($13, po_ref),
       pss_qty_grams   = COALESCE($14, pss_qty_grams),
       updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, body.contract_number?.trim() ?? null, body.client_id ?? null, body.client_name ?? null,
     body.quality ?? null, body.destination ?? null, body.shipment_date ?? null, body.shipment_month ?? null,
     body.containers ?? null, body.pss_expected ?? null, body.notes ?? null, body.status ?? null,
     body.po_ref || null, body.pss_qty_grams ?? null],
    {
      entityType: 'contract',
      type: statusChange ? 'status_change' : 'edited',
      note: statusChange ? `${prev.status} → ${body.status}` : `fields updated: ${Object.keys(body).join(', ')}`,
      actor,
    },
    // pss_expected / status changes redraw the picture, so the machine gets the last word.
    async (client, updated) => { out.status = (await recomputeContractStatus(client, String(updated.id), actor)).status; },
  );
  if (!row) throw new HttpError(404, 'contract not found');
  res.json({ ...row, status: out.status ?? row.status });
}));

contracts.delete('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const actor = actorFrom(req);
  const row = await runWithEvent<{ id: string; contract_number: string }>(
    `UPDATE contracts SET deleted_at = now(), updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id], { entityType: 'contract', type: 'deleted', note: 'soft-deleted', actor },
    // The samples keep their contract_id: the link is history, and the number is freed for a re-import.
    async (client, deleted) =>
      enqueueDeleted(client, 'contract', String(deleted.id), actor, { contract_number: deleted.contract_number }),
  );
  if (!row) throw new HttpError(404, 'contract not found');
  res.json({ ok: true, id });
}));

/**
 * Dashboard "Draw PSS": raise the request for one container. The contract is locked FOR UPDATE before
 * the container is inspected, so two people drawing the same container cannot both pass the guard.
 */
contracts.post('/:id/draw-pss', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { container_no } = parseBody(drawSchema, req.body);
  const actor = actorFrom(req);
  const client = await pool.connect();
  let drawn: { id: string; sample_ref: string };
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT id FROM contracts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    if (!cur.rows[0]) throw new HttpError(404, 'contract not found');
    // Only a slot with nothing live — or whose options were all rejected — may be drawn by hand
    // (a rejection draws its own replacement, so this is the "the auto-draw was deleted" path).
    const live = (await loadContractPss(client, id)).filter((r) => r.container_no === container_no);
    if (live.some((r) => r.result_norm !== 'rejected')) {
      throw new HttpError(409, `option slot ${container_no} already has a live PSS`);
    }
    drawn = await drawPss(client, { contractId: id, containerNo: container_no, actor });
    await recomputeContractStatus(client, id, actor);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    // A refused request is not a broken connection: only a real fault destroys it.
    client.release(e instanceof HttpError ? undefined : (e as Error));
    throw e;
  }
  client.release();
  res.status(201).json({ ...drawn, contract_id: id, container_no });
}));

/** Attach a sample that already exists (logged before anyone knew its contract) to a container. */
contracts.post('/:id/link', h(async (req, res) => {
  const id = parseId(req.params.id);
  const body = parseBody(linkSchema, req.body);
  const actor = actorFrom(req);
  const table = body.tab === 'bulk' ? 'bulk_samples' : 'specialty_samples';
  const refColumn = body.tab === 'bulk' ? 'sample_ref' : 'ref';

  const client = await pool.connect();
  let containerNo: number | null;
  try {
    await client.query('BEGIN');
    // Locked first: the free-container lookup below must not race another link or draw.
    const cur = await client.query(`SELECT * FROM contracts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    const contract = cur.rows[0];
    if (!contract) throw new HttpError(404, 'contract not found');
    // A contract's options are pre-shipment samples in slots the contract actually has. Anything else
    // would sit in the contract's picture without ever being counted (loadContractPss filters on
    // sample_type_norm = 'pss'; containerStates buckets 1..pss_expected only).
    const { rows: sampleRows } = await client.query(
      `SELECT sample_type_norm FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [body.sample_id]);
    if (!sampleRows[0]) throw new HttpError(404, `${body.tab} sample not found`);
    if (sampleRows[0].sample_type_norm !== 'pss') {
      throw new HttpError(409, `that ${body.tab} sample is not a PSS — only a pre-shipment sample can be a contract option`);
    }
    if (body.container_no != null && body.container_no > contract.pss_expected) {
      throw new HttpError(400, `contract ${contract.contract_number} expects ${contract.pss_expected} option(s) — there is no slot ${body.container_no}`, { pss_expected: contract.pss_expected });
    }
    containerNo = body.container_no ?? await firstFreeContainer(client, id, contract.pss_expected);
    // The linked sample keeps its own ref (it exists) but takes the next option letter.
    const letter = nextOptionLetters(await usedOptionLetters(client, id), 1)[0];
    const { rows } = await client.query(
      `UPDATE ${table} SET contract_id = $2, contract_number = $3, container_no = $4, option_letter = $5, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING id, ${refColumn} AS ref`,
      [body.sample_id, id, contract.contract_number, containerNo, letter],
    );
    const sample = rows[0];
    if (!sample) throw new HttpError(404, `${body.tab} sample not found`);
    const where = containerNo ? ` option ${letter} (slot ${containerNo})` : ` option ${letter} (no free slot)`;
    await client.query(
      `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ($1, $2, 'edited', $3, $4)`,
      [body.tab, body.sample_id, `linked to contract ${contract.contract_number}${where}`, actor],
    );
    await client.query(
      `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('contract', $1, 'edited', $2, $3)`,
      [id, `linked ${body.tab} sample ${sample.ref ?? body.sample_id}${where}`, actor],
    );
    await recomputeContractStatus(client, id, actor);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    client.release(e instanceof HttpError ? undefined : (e as Error));
    throw e;
  }
  client.release();
  res.json({ ok: true, tab: body.tab, id: body.sample_id, container_no: containerNo });
}));
