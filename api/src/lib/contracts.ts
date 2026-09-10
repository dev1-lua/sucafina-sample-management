import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';
import { issueRef } from './refs.js';
import { enqueueOutbox } from './notify-outbox.js';

// Contracts + pre-shipment samples (migration 020, reshaped by 021 — Harriet, round 6 + her answers of
// 2026-09-10). A contract owes N lettered PSS OPTIONS (A, B, C… — "CK wants 2 options of 500 g", "JDE a
// PSS per PO") 45 days before the shipment date. Each option fills one SLOT (container_no, 1..pss_expected)
// and carries its own letter and a contract-derived ref: SSKE-<contract digits><letter>. The client may
// reject an option: EVERY rejection draws a replacement in the same slot with the next unused letter (A–C
// rejected → D–F); the second rejection in a slot also flags the whole contract "PSS replacement rejected"
// until an option in that slot is approved. The status machine below is pure — every DB-touching
// function feeds it rows and writes back what it returns, so the rules can be pinned down without a DB.

type Q = Pick<PoolClient, 'query'> | typeof pool;

export type ContainerState = 'none' | 'pending' | 'approved' | 'replacement_pending' | 'failed';
export type ContractStatus =
  'open' | 'pss_pending' | 'pss_partial' | 'pss_replacement_rejected' | 'pss_approved' | 'shipped' | 'cancelled';

export type PssRow = {
  tab: 'specialty' | 'bulk';
  id: string;
  ref: string | null;
  container_no: number | null;
  option_letter?: string | null;
  status: string;
  result_norm: string | null;
  replaces_sample_id: string | null;
  awb: string | null;
  dispatched_on: string | null;
  result_on: string | null;
};

// ---- option letters + refs -------------------------------------------------------------------------

/** 1 → A … 26 → Z, 27 → AA (a contract never gets there; the sheet's largest set is 8 × 1 kg). */
export function optionLetter(index: number): string {
  let n = Math.max(1, Math.trunc(index));
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.trunc((n - 1) / 26);
  }
  return out;
}

function letterIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.trim().toUpperCase()) {
    const c = ch.charCodeAt(0) - 64;
    if (c < 1 || c > 26) return 0;
    n = n * 26 + c;
  }
  return n;
}

/**
 * The next `count` letters after the highest one in play on the contract — Harriet: "the suffix moves to
 * the next letter"; A–C rejected → D–F. A letter is "in play" while a live (not deleted) row carries it,
 * so a deleted option's letter comes back, the same way a deleted ref does.
 */
export function nextOptionLetters(used: Array<string | null | undefined>, count: number): string[] {
  const top = used.reduce((m, u) => Math.max(m, letterIndex(u ?? '')), 0);
  return Array.from({ length: Math.max(0, count) }, (_, i) => optionLetter(top + 1 + i));
}

/**
 * The PSS ref the desk writes: SSKE-<the contract number's digits><option letter> (the pending-dispatch
 * sheet: SSKE-103503, SSKE-104929D-F). Null when the number carries no digits — the caller then falls
 * back to the SSKE counter, which is otherwise never used for a contract PSS (its 108000s collide with
 * real contracts).
 */
export function pssRefFor(contractNumber: string | null | undefined, letter: string): string | null {
  const digits = (contractNumber ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return `SSKE-${digits}${letter.trim().toUpperCase()}`;
}

/** Harriet's status vocabulary for one PSS row (the pending-dispatch sheet's Status column). */
export function pssStageLabel(r: Pick<PssRow, 'status' | 'result_norm' | 'replaces_sample_id'>): string {
  if (r.status === 'cancelled') return 'Cancelled';
  const repl = !!r.replaces_sample_id;
  if (r.result_norm === 'approved') return 'Sample approved';
  if (r.result_norm === 'rejected') return repl ? 'PSS replacement rejected' : 'PSS rejected';
  if (r.status === 'requested' || r.status === 'preparing') return repl ? 'Replacement PSS requested after rejection' : 'Pending PSS dispatch';
  if (r.status === 'dispatched' && !r.result_norm) return repl ? 'Pending replacement results' : 'PSS dispatched';
  return repl ? 'Pending replacement results' : 'Pending PSS results';
}

const qtyText = (g: number): string => (g % 1000 === 0 ? `${g / 1000}kg` : `${g}g`);

/** Is this ref already on a live row in either book? (No unique index exists on the ref columns.) */
async function refTaken(db: Q, ref: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM bulk_samples WHERE sample_ref = $1 AND deleted_at IS NULL
     UNION ALL
     SELECT 1 FROM specialty_samples WHERE ref = $1 AND deleted_at IS NULL
     LIMIT 1`,
    [ref],
  );
  return rows.length > 0;
}
/** Stamped on a row whose size was assumed, so that row never becomes another draw's "history". */
export const QTY_ASSUMED_NOTE = '1 kg assumed';

// ---- the status machine (pure) ---------------------------------------------------------------------

/** One slot's LIVE PSS rows (deleted_at IS NULL, status <> 'cancelled') → where that slot stands. */
export function containerState(rows: PssRow[]): ContainerState {
  if (rows.length === 0) return 'none';
  if (rows.some((r) => r.result_norm === 'approved')) return 'approved';
  const rejections = rows.filter((r) => r.result_norm === 'rejected').length;
  if (rejections >= 2) return 'failed';                 // rejected twice: the contract is flagged (a new option is still drawn)
  if (rejections === 1) return 'replacement_pending';   // one rejection: the replacement is on its way
  return 'pending';
}

/** The slots' states → the contract's status. `shipped` / `cancelled` are set by hand and stick. */
export function contractStatusFrom(states: ContainerState[], current: ContractStatus): ContractStatus {
  if (current === 'shipped' || current === 'cancelled') return current;
  if (states.every((s) => s === 'none')) return 'open';
  if (states.some((s) => s === 'failed')) return 'pss_replacement_rejected';
  if (states.every((s) => s === 'approved')) return 'pss_approved';
  if (states.some((s) => s === 'approved' || s === 'replacement_pending')) return 'pss_partial';
  return 'pss_pending';
}

/**
 * Slots 1..pssExpected with their rows and state. Rows with no container_no (and any beyond the expected
 * count) are NOT bucketed here — GET /contracts/:id reports them as `unassigned`.
 */
export function containerStates(
  rows: PssRow[],
  pssExpected: number,
): { container_no: number; state: ContainerState; samples: PssRow[] }[] {
  const out = [];
  for (let n = 1; n <= pssExpected; n++) {
    const samples = rows.filter((r) => r.container_no === n);
    out.push({ container_no: n, state: containerState(samples), samples });
  }
  return out;
}

// ---- reading ----------------------------------------------------------------------------------------

/** The lowest slot (1..pssExpected) with no live PSS row yet, or null when every one is taken. */
export async function firstFreeContainer(db: Q, contractId: string, pssExpected: number): Promise<number | null> {
  const rows = await loadContractPss(db, contractId);
  for (let n = 1; n <= pssExpected; n++) {
    if (!rows.some((r) => r.container_no === n)) return n;
  }
  return null;
}

/** Every option letter a live row on the contract carries (any status), for nextOptionLetters. */
export async function usedOptionLetters(db: Q, contractId: string): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT option_letter FROM bulk_samples WHERE contract_id = $1 AND deleted_at IS NULL AND option_letter IS NOT NULL
     UNION ALL
     SELECT option_letter FROM specialty_samples WHERE contract_id = $1 AND deleted_at IS NULL AND option_letter IS NOT NULL`,
    [contractId],
  );
  return rows.map((r) => String(r.option_letter));
}

/**
 * Resolve the contract a freshly logged sample belongs to from its contract NUMBER — the only handle the
 * agent and the SOL sheet have. Shared by both sample routers' POST. Non-PSS rows, unknown numbers and
 * deleted contracts all resolve to "unlinked"; an explicit slot always wins over the free one. A linked
 * PSS also gets its option letter and the contract-derived ref (used unless the caller typed one).
 */
export async function resolveContractLink(
  db: Q,
  o: { contract_number?: string | null; sample_type_norm?: string | null; container_no?: number | null },
): Promise<{ contract_id: string | null; container_no: number | null; option_letter: string | null; ref: string | null }> {
  const containerNo = o.container_no ?? null;
  const none = { contract_id: null, container_no: containerNo, option_letter: null, ref: null };
  if (!o.contract_number || o.sample_type_norm !== 'pss') return none;
  const { rows } = await db.query(
    `SELECT id, contract_number, pss_expected FROM contracts
      WHERE upper(trim(contract_number)) = upper(trim($1)) AND deleted_at IS NULL`,
    [o.contract_number],
  );
  if (!rows[0]) return none;
  const contractId = String(rows[0].id);
  const letter = nextOptionLetters(await usedOptionLetters(db, contractId), 1)[0];
  return {
    contract_id: contractId,
    container_no: containerNo ?? (await firstFreeContainer(db, contractId, rows[0].pss_expected)),
    option_letter: letter,
    ref: pssRefFor(String(rows[0].contract_number), letter),
  };
}

/** Every live PSS row on a contract, from both books, oldest first within a slot. */
export async function loadContractPss(db: Q, contractId: string): Promise<PssRow[]> {
  const { rows } = await db.query(
    `SELECT 'specialty'::text AS tab, id, ref, container_no, option_letter, status::text AS status,
            result_norm::text AS result_norm, replaces_sample_id, awb, dispatched_on, result_on, created_at
       FROM specialty_samples
      WHERE contract_id = $1 AND sample_type_norm = 'pss' AND deleted_at IS NULL AND status <> 'cancelled'
     UNION ALL
     SELECT 'bulk', id, sample_ref, container_no, option_letter, status::text,
            result_norm::text, replaces_sample_id, awb, dispatched_on, result_on, created_at
       FROM bulk_samples
      WHERE contract_id = $1 AND sample_type_norm = 'pss' AND deleted_at IS NULL AND status <> 'cancelled'
      ORDER BY container_no NULLS LAST, created_at`,
    [contractId],
  );
  return rows.map(({ created_at, ...r }) => r) as PssRow[];
}

// ---- writing ----------------------------------------------------------------------------------------

/**
 * Re-derive a contract's status from its PSS rows and write it back — always on the SAME transaction as
 * the sample write that triggered it, so status and samples can never disagree. The contract row is
 * locked FOR UPDATE: two slots reaching a verdict at once must not race each other's recompute.
 */
export async function recomputeContractStatus(
  client: PoolClient,
  contractId: string,
  actor: string,
): Promise<{ status: ContractStatus; changed: boolean }> {
  const { rows } = await client.query(
    `SELECT * FROM contracts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
    [contractId],
  );
  const contract = rows[0];
  // Deleted (or never existed) → nothing to recompute; the samples keep their contract_id for audit.
  if (!contract) return { status: 'open', changed: false };

  const pssRows = await loadContractPss(client, contractId);
  const states = containerStates(pssRows, contract.pss_expected);
  const current = contract.status as ContractStatus;
  const next = contractStatusFrom(states.map((s) => s.state), current);
  if (next === current) return { status: current, changed: false };

  await client.query(`UPDATE contracts SET status = $2, updated_at = now() WHERE id = $1`, [contractId, next]);
  await client.query(
    `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('contract', $1, 'status_change', $2, $3)`,
    [contractId, `${current} → ${next}`, actor],
  );
  if (next === 'pss_replacement_rejected') {
    const failed = states.filter((s) => s.state === 'failed');
    // Per failed slot: the option whose rejection tipped it (the latest rejected letter) and the
    // replacement drawn for it (the latest row still without a verdict), so the ping can name both.
    const latest = (rows: PssRow[]) => rows[rows.length - 1];
    const failedOptions = failed.map((s) => latest(s.samples.filter((r) => r.result_norm === 'rejected'))?.option_letter ?? null);
    const replacements = failed.map((s) => latest(s.samples.filter((r) => !r.result_norm))?.ref ?? null);
    await enqueueOutbox(client, {
      tab: 'contract', sampleId: contractId, event: 'pss_rejected', recipient: 'qc',
      payload: {
        contract_number: contract.contract_number,
        client_name: contract.client_name,
        failed_containers: failed.map((s) => s.container_no),
        failed_options: failedOptions.filter((l): l is string => !!l),
        replacements: replacements.filter((r): r is string => !!r),
      },
      actor,
    });
  }
  return { status: next, changed: true };
}

/**
 * Grams per option for a draw: the contract says, else the client's usual (their last PSS in the
 * Commercial book), else 1 kg — flagged in the row's comments so nobody mistakes the assumption for
 * a fact (Harriet: Nespresso 1 kg, Zoegas 600 g, JDE 300 g, CK 500 g — never a fixed 1 kg).
 */
async function pssQtyFor(db: Q, contract: { pss_qty_grams: number | null; client_id: string | null }): Promise<{ grams: number; assumed: boolean }> {
  if (contract.pss_qty_grams && contract.pss_qty_grams > 0) return { grams: Number(contract.pss_qty_grams), assumed: false };
  if (contract.client_id) {
    const { rows } = await db.query(
      `SELECT qty_grams FROM bulk_samples
        WHERE client_id = $1 AND sample_type_norm = 'pss' AND qty_grams > 0 AND deleted_at IS NULL
          AND (comments IS NULL OR comments NOT LIKE $2)
        ORDER BY created_at DESC LIMIT 1`,
      [contract.client_id, `%${QTY_ASSUMED_NOTE}%`],
    );
    if (rows[0]) return { grams: Number(rows[0].qty_grams), assumed: false };
  }
  return { grams: 1000, assumed: true };
}

/**
 * Draw one PSS option into a slot. Always a BULK row: pre-shipment samples are green-coffee lots from the
 * contract, which is the bulk book's business whichever book the rejected sample lived in. The option
 * letter is the next unused one on the contract (or the caller's), the ref is contract-derived, the
 * quantity is the contract's grams per option (see pssQtyFor). A replacement (o.replacesSampleId) also
 * pings QC — a plain first draw is silent, the contract itself is the record.
 */
export async function drawPss(
  client: PoolClient,
  o: {
    contractId: string; containerNo: number; actor: string;
    replacesSampleId?: string; reason?: string; optionLetter?: string;
    requestedBy?: string | null; loggedBy?: string | null; comments?: string;
  },
): Promise<{ id: string; sample_ref: string; option_letter: string }> {
  const { rows: cRows } = await client.query(
    `SELECT c.*, cl.name AS resolved_client_name
       FROM contracts c LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [o.contractId],
  );
  const contract = cRows[0];
  // A deleted contract owes nothing: never draw against it, and never ping QC about one.
  if (!contract) throw new HttpError(404, 'contract not found');

  const letter = o.optionLetter?.trim().toUpperCase() || nextOptionLetters(await usedOptionLetters(client, o.contractId), 1)[0];
  // The ref is the contract's own digits + the letter. Two DIFFERENT contract numbers can reduce to the
  // same digits ("SSKE-104929" vs "SSKE 104929" — the contracts index is on the whole trimmed number), and
  // a duplicate ref would make the agent refuse both rows ("Several rows share ref …", lib/resolve-sample).
  // So a taken ref falls back to the SSKE counter. Rides the caller's transaction: a rolled-back draw
  // never burns a counter number either.
  const derived = pssRefFor(String(contract.contract_number), letter);
  const taken = derived ? await refTaken(client, derived) : true;
  const sampleRef = derived && !taken ? derived : `${await issueRef('pss', client)}${letter}`;
  const qty = await pssQtyFor(client, contract);
  const clientName = contract.client_name ?? contract.resolved_client_name ?? 'the client';
  const comments = [
    o.comments ?? null,
    qty.assumed ? `${QTY_ASSUMED_NOTE} — no PSS size on the contract or in ${clientName}'s history` : null,
  ].filter(Boolean).join(' — ') || null;
  const { rows } = await client.query(
    `INSERT INTO bulk_samples
       (sample_ref, quality, client, client_id, country, shipment_month, contract_number, contract_id,
        container_no, option_letter, replaces_sample_id, sample_type_norm, qty, qty_grams, comments,
        requested_by, logged_by, date, date_on, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pss',$12,$13,$14,$15,$16,
             to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD'),
             (now() AT TIME ZONE 'Africa/Nairobi')::date,
             'requested')
     RETURNING id, sample_ref, option_letter`,
    [sampleRef, contract.quality, contract.client_name ?? contract.resolved_client_name, contract.client_id,
     contract.destination, contract.shipment_month, contract.contract_number, o.contractId,
     o.containerNo, letter, o.replacesSampleId ?? null, qtyText(qty.grams), qty.grams, comments,
     o.requestedBy ?? null, o.loggedBy ?? null],
  );
  const row = rows[0];
  await client.query(
    `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('bulk', $1, 'created', $2, $3)`,
    [row.id, `PSS ${sampleRef} — option ${letter} (slot ${o.containerNo}) for contract ${contract.contract_number}`, o.actor],
  );
  if (o.replacesSampleId) {
    const { rows: prevRows } = await client.query(
      `SELECT ref FROM specialty_samples WHERE id = $1
       UNION ALL
       SELECT sample_ref FROM bulk_samples WHERE id = $1`,
      [o.replacesSampleId],
    );
    await enqueueOutbox(client, {
      tab: 'bulk', sampleId: String(row.id), event: 'created', recipient: 'qc',
      payload: { replacement_of: prevRows[0]?.ref ?? null, reason: o.reason ?? null },
      actor: o.actor,
    });
  }
  return { id: String(row.id), sample_ref: String(row.sample_ref), option_letter: String(row.option_letter) };
}

/**
 * PATCH hook: the client just rejected a PSS. EVERY rejection in a slot draws its replacement with the
 * next letter (Harriet: "flag the contract AND draw the third sample with the next letter"); the flag
 * itself is recomputeContractStatus's business. Never twice for the same row (a rejected → approved →
 * rejected flip-flop), never once the slot has an approval, never on a deleted contract.
 */
export async function maybeDrawReplacement(
  client: PoolClient,
  tab: 'specialty' | 'bulk',
  row: Record<string, unknown>,
  prev: Record<string, unknown>,
  actor: string,
): Promise<{ drawn: { id: string; sample_ref: string; option_letter: string } | null }> {
  const contractId = row.contract_id ? String(row.contract_id) : null;
  if (!contractId) return { drawn: null };

  const flippedToRejected = row.result_norm === 'rejected' && prev.result_norm !== 'rejected';
  const containerNo = row.container_no == null ? null : Number(row.container_no);
  let drawn: { id: string; sample_ref: string; option_letter: string } | null = null;

  if (flippedToRejected && row.sample_type_norm === 'pss' && containerNo != null) {
    // A soft-deleted contract is out of the game: no replacement, no QC ping (the recompute below no-ops).
    const { rows: live } = await client.query(
      `SELECT 1 FROM contracts WHERE id = $1 AND deleted_at IS NULL`, [contractId],
    );
    const slot = (await loadContractPss(client, contractId)).filter((r) => r.container_no === containerNo);
    const approved = slot.some((r) => r.result_norm === 'approved');
    const alreadyReplaced = slot.some((r) => r.replaces_sample_id === String(row.id));
    if (live.length > 0 && !approved && !alreadyReplaced) {
      const reason = (row.rejection_reason as string | null) ?? 'no reason given';
      const ref = String((tab === 'bulk' ? row.sample_ref : row.ref) ?? '');
      drawn = await drawPss(client, {
        contractId, containerNo, actor,
        replacesSampleId: String(row.id), reason,
        requestedBy: (row.requested_by as string | null) ?? null,
        loggedBy: (row.logged_by as string | null) ?? null,
        comments: `Replacement PSS for ${ref} — client rejected: ${reason}`,
      });
    }
  }
  await recomputeContractStatus(client, contractId, actor);
  return { drawn };
}
