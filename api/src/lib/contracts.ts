import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';
import { issueRef } from './refs.js';
import { enqueueOutbox } from './notify-outbox.js';

// Contracts + pre-shipment samples (migration 020; Harriet, round 6). A contract ships N containers
// and owes one PSS per container 45 days before the shipment date. The client may reject a PSS: the
// first rejection on a container draws a replacement automatically, a second one fails the container
// and flags the whole contract. The status machine below is pure — every DB-touching function feeds
// it rows and writes back what it returns, so the rules can be pinned down without a database.

type Q = Pick<PoolClient, 'query'> | typeof pool;

export type ContainerState = 'none' | 'pending' | 'approved' | 'replacement_pending' | 'failed';
export type ContractStatus =
  'open' | 'pss_pending' | 'pss_partial' | 'pss_rejected' | 'pss_approved' | 'shipped' | 'cancelled';

export type PssRow = {
  tab: 'specialty' | 'bulk';
  id: string;
  ref: string | null;
  container_no: number | null;
  status: string;
  result_norm: string | null;
  replaces_sample_id: string | null;
  awb: string | null;
  dispatched_on: string | null;
  result_on: string | null;
};

/** One container's LIVE PSS rows (deleted_at IS NULL, status <> 'cancelled') → where that container stands. */
export function containerState(rows: PssRow[]): ContainerState {
  if (rows.length === 0) return 'none';
  if (rows.some((r) => r.result_norm === 'approved')) return 'approved';
  const rejections = rows.filter((r) => r.result_norm === 'rejected').length;
  if (rejections >= 2) return 'failed';                 // rejected twice: no further auto-draw, QC decides
  if (rejections === 1) return 'replacement_pending';   // one rejection: the replacement is on its way
  return 'pending';
}

/** The containers' states → the contract's status. `shipped` / `cancelled` are set by hand and stick. */
export function contractStatusFrom(states: ContainerState[], current: ContractStatus): ContractStatus {
  if (current === 'shipped' || current === 'cancelled') return current;
  if (states.every((s) => s === 'none')) return 'open';
  if (states.some((s) => s === 'failed')) return 'pss_rejected';
  if (states.every((s) => s === 'approved')) return 'pss_approved';
  if (states.some((s) => s === 'approved' || s === 'replacement_pending')) return 'pss_partial';
  return 'pss_pending';
}

/**
 * Containers 1..pssExpected with their rows and state. Rows with no container_no (and any beyond the
 * expected count) are NOT bucketed here — GET /contracts/:id reports them as `unassigned`.
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

/** The lowest container (1..pssExpected) with no live PSS row yet, or null when every one is taken. */
export async function firstFreeContainer(db: Q, contractId: string, pssExpected: number): Promise<number | null> {
  const rows = await loadContractPss(db, contractId);
  for (let n = 1; n <= pssExpected; n++) {
    if (!rows.some((r) => r.container_no === n)) return n;
  }
  return null;
}

/**
 * Resolve the contract a freshly logged sample belongs to from its contract NUMBER — the only handle the
 * agent and the SOL sheet have. Shared by both sample routers' POST. Non-PSS rows, unknown numbers and
 * deleted contracts all resolve to "unlinked"; an explicit container_no always wins over the free one.
 */
export async function resolveContractLink(
  db: Q,
  o: { contract_number?: string | null; sample_type_norm?: string | null; container_no?: number | null },
): Promise<{ contract_id: string | null; container_no: number | null }> {
  const containerNo = o.container_no ?? null;
  if (!o.contract_number || o.sample_type_norm !== 'pss') return { contract_id: null, container_no: containerNo };
  const { rows } = await db.query(
    `SELECT id, pss_expected FROM contracts
      WHERE upper(trim(contract_number)) = upper(trim($1)) AND deleted_at IS NULL`,
    [o.contract_number],
  );
  if (!rows[0]) return { contract_id: null, container_no: containerNo };
  return {
    contract_id: String(rows[0].id),
    container_no: containerNo ?? (await firstFreeContainer(db, String(rows[0].id), rows[0].pss_expected)),
  };
}

/** Every live PSS row on a contract, from both books, oldest first within a container. */
export async function loadContractPss(db: Q, contractId: string): Promise<PssRow[]> {
  const { rows } = await db.query(
    `SELECT 'specialty'::text AS tab, id, ref, container_no, status::text AS status,
            result_norm::text AS result_norm, replaces_sample_id, awb, dispatched_on, result_on, created_at
       FROM specialty_samples
      WHERE contract_id = $1 AND sample_type_norm = 'pss' AND deleted_at IS NULL AND status <> 'cancelled'
     UNION ALL
     SELECT 'bulk', id, sample_ref, container_no, status::text,
            result_norm::text, replaces_sample_id, awb, dispatched_on, result_on, created_at
       FROM bulk_samples
      WHERE contract_id = $1 AND sample_type_norm = 'pss' AND deleted_at IS NULL AND status <> 'cancelled'
      ORDER BY container_no NULLS LAST, created_at`,
    [contractId],
  );
  return rows.map(({ created_at, ...r }) => r) as PssRow[];
}

/**
 * Re-derive a contract's status from its PSS rows and write it back — always on the SAME transaction as
 * the sample write that triggered it, so status and samples can never disagree. The contract row is
 * locked FOR UPDATE: two containers reaching a verdict at once must not race each other's recompute.
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
  if (next === 'pss_rejected') {
    await enqueueOutbox(client, {
      tab: 'contract', sampleId: contractId, event: 'pss_rejected', recipient: 'qc',
      payload: {
        contract_number: contract.contract_number,
        client_name: contract.client_name,
        failed_containers: states.filter((s) => s.state === 'failed').map((s) => s.container_no),
      },
      actor,
    });
  }
  return { status: next, changed: true };
}

/**
 * Draw a PSS for one container. Always a BULK row: pre-shipment samples are green-coffee lots from the
 * contract, which is the bulk book's business whichever book the rejected sample lived in. A replacement
 * (o.replacesSampleId) also pings QC — a plain first draw is silent, the contract itself is the record.
 */
export async function drawPss(
  client: PoolClient,
  o: {
    contractId: string; containerNo: number; actor: string;
    replacesSampleId?: string; reason?: string;
    requestedBy?: string | null; loggedBy?: string | null; comments?: string;
  },
): Promise<{ id: string; sample_ref: string }> {
  const { rows: cRows } = await client.query(
    `SELECT c.*, cl.name AS resolved_client_name
       FROM contracts c LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [o.contractId],
  );
  const contract = cRows[0];
  // A deleted contract owes nothing: never draw against it, and never ping QC about one.
  if (!contract) throw new HttpError(404, 'contract not found');

  // Rides the caller's transaction: a rolled-back draw never burns an SSKE number.
  const sampleRef = await issueRef('pss', client);
  const { rows } = await client.query(
    `INSERT INTO bulk_samples
       (sample_ref, quality, client, client_id, country, shipment_month, contract_number, contract_id,
        container_no, replaces_sample_id, sample_type_norm, qty, qty_grams, comments,
        requested_by, logged_by, date, date_on, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pss','1kg',1000,$11,$12,$13,
             to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD'),
             (now() AT TIME ZONE 'Africa/Nairobi')::date,
             'requested')
     RETURNING id, sample_ref`,
    [sampleRef, contract.quality, contract.client_name ?? contract.resolved_client_name, contract.client_id,
     contract.destination, contract.shipment_month, contract.contract_number, o.contractId,
     o.containerNo, o.replacesSampleId ?? null, o.comments ?? null,
     o.requestedBy ?? null, o.loggedBy ?? null],
  );
  const row = rows[0];
  await client.query(
    `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('bulk', $1, 'created', $2, $3)`,
    [row.id, `PSS ${sampleRef} for contract ${contract.contract_number} container ${o.containerNo}`, o.actor],
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
  return { id: String(row.id), sample_ref: String(row.sample_ref) };
}

/**
 * PATCH hook: the client just rejected a PSS. The FIRST rejection on a container draws its replacement
 * automatically (Harriet: "client can reject one out of X"); a second one is left alone — the container
 * has failed and recomputeContractStatus flags the contract instead.
 */
export async function maybeDrawReplacement(
  client: PoolClient,
  tab: 'specialty' | 'bulk',
  row: Record<string, unknown>,
  prev: Record<string, unknown>,
  actor: string,
): Promise<{ drawn: { id: string; sample_ref: string } | null }> {
  const contractId = row.contract_id ? String(row.contract_id) : null;
  if (!contractId) return { drawn: null };

  const flippedToRejected = row.result_norm === 'rejected' && prev.result_norm !== 'rejected';
  const containerNo = row.container_no == null ? null : Number(row.container_no);
  let drawn: { id: string; sample_ref: string } | null = null;

  if (flippedToRejected && row.sample_type_norm === 'pss' && containerNo != null) {
    // A soft-deleted contract is out of the game: no replacement, no QC ping (the recompute below no-ops).
    const { rows: live } = await client.query(
      `SELECT 1 FROM contracts WHERE id = $1 AND deleted_at IS NULL`, [contractId],
    );
    const container = (await loadContractPss(client, contractId)).filter((r) => r.container_no === containerNo);
    const rejections = container.filter((r) => r.result_norm === 'rejected').length;
    const approved = container.some((r) => r.result_norm === 'approved');
    // A rejected → approved → rejected flip-flop must not draw a second replacement for the same row.
    const alreadyReplaced = container.some((r) => r.replaces_sample_id === String(row.id));
    if (live.length > 0 && rejections === 1 && !approved && !alreadyReplaced) {
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
