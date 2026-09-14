import type { PoolClient } from 'pg';
import { pool } from '../db.js';

// "Log first, complete later" (migration 016). A sample is written before the client's delivery
// address exists; this module is the one place that knows how the gap is read, recorded and closed.

type Db = Pick<PoolClient, 'query'> | typeof pool;

/**
 * Extra SELECT columns for a sample table aliased `alias` (the table name itself in buildList).
 * The correlated subqueries name `${alias}.client_id` explicitly — a bare `client_id` inside them
 * binds to r.client_id and is always true.
 */
export function gapColumns(alias: string): string {
  return `client_address_missing(${alias}.client_id) AS client_address_missing,
    (SELECT r.asked_name FROM client_detail_requests r WHERE r.client_id = ${alias}.client_id AND r.resolved_at IS NULL) AS details_requested_from,
    (SELECT r.asked_at   FROM client_detail_requests r WHERE r.client_id = ${alias}.client_id AND r.resolved_at IS NULL) AS details_requested_at,
    ${awaitingCollectionExpr(alias)} AS awaiting_collection`;
}

// "When the AWB is added it means the coffee is awaiting collection by DHL" (lifecycle sketch,
// 2026-09-14). Derived on every read, never stored: the row has an AWB but has not been marked
// dispatched. One rule for the three books, /search, the outbox and the dashboard/agent readers.
export function awaitingCollectionExpr(alias: string): string {
  return `(${alias}.awb IS NOT NULL AND ${alias}.awb <> '' AND ${alias}.status IN ('requested', 'preparing'))`;
}

/** WHERE fragment for `?awaiting_collection=true` on the per-book list routes (unaliased table scope). */
export const AWAITING_COLLECTION_WHERE = `awb IS NOT NULL AND awb <> '' AND status IN ('requested', 'preparing')`;

export type OpenSample = {
  tab: 'specialty' | 'bulk' | 'forwarding';
  id: string;
  ref: string | null;
  title: string | null;
  qty_grams: number | null;
  requested_by: string | null;
  logged_by: string | null;
  priority: string | null;
  date_on: string | null;
};

/** The client's samples still waiting to go out — the ones a missing address actually blocks. */
export async function openSamplesFor(db: Db, clientId: string): Promise<OpenSample[]> {
  const { rows } = await db.query(
    `SELECT tab, id, ref, title, qty_grams, requested_by, logged_by, priority, date_on
       FROM all_samples_v
      WHERE client_id = $1 AND deleted_at IS NULL AND status IN ('requested','preparing')
      ORDER BY priority DESC, date_on, ref`,
    [clientId],
  );
  return rows as OpenSample[];
}

export async function openDetailRequest(db: Db, clientId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await db.query(
    `SELECT * FROM client_detail_requests WHERE client_id = $1 AND resolved_at IS NULL`,
    [clientId],
  );
  return rows[0] ?? null;
}

/**
 * Close the open ask once the client has a street address (called after every contact write:
 * POST /clients existing-name path, POST /clients/:id/contacts, merge). Writes `details_resolved`
 * on the client and on each sample that was waiting. No-op when nothing was open or the gap remains.
 */
export async function resolveDetailRequests(db: Db, clientId: string, actor: string): Promise<boolean> {
  const { rows } = await db.query(
    `UPDATE client_detail_requests SET resolved_at = now()
      WHERE client_id = $1 AND resolved_at IS NULL AND NOT client_address_missing($1)
      RETURNING *`,
    [clientId],
  );
  const req = rows[0];
  if (!req) return false;
  const who = req.asked_name ?? req.asked_email;
  const note = `delivery address received — ${who ? `ask to ${who} closed` : 'open ask closed'}`;
  await db.query(
    `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('client', $1, 'details_resolved', $2, $3)`,
    [clientId, note, actor],
  );
  for (const s of await openSamplesFor(db, clientId)) {
    await db.query(
      `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ($1, $2, 'details_resolved', $3, $4)`,
      [s.tab, s.id, note, actor],
    );
  }
  return true;
}
