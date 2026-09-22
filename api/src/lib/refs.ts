import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { releaseLotIfOrphaned } from './lots.js';

// Sample-type → ref prefix. pss=Shipment Sample Kenya, type=Type sample; everything else
// (offer, specialty lots, woc, retention, …) falls back to SL. Every prefix here must have a
// seeded row in ref_counters (migration 001) or issueRef throws on the missing counter row.
// Counters were restarted by migration 015 (SL → 7459, TYPE → 108; Brillian, Aug 2026); format is
// unpadded ("SL-7459").
const PREFIX: Record<string, string> = { pss: 'SSKE', type: 'TYPE' };

// `db` lets a caller mint the ref on ITS OWN transaction (phase 5: the PSS replacement draw runs
// inside the rejecting PATCH) so a rolled-back write never burns a number. Default = the pool, i.e.
// its own auto-committed statement, which is what every pre-existing caller wants.
export async function issueRef(sampleType: string, db: Pick<PoolClient, 'query'> = pool): Promise<string> {
  const prefix = PREFIX[sampleType] ?? 'SL';
  const { rows } = await db.query(
    `UPDATE ref_counters SET next_val = next_val + 1 WHERE prefix = $1 RETURNING next_val - 1 AS val`,
    [prefix]
  );
  return `${prefix}-${rows[0].val}`;
}

/**
 * Mint the next consignment number, e.g. "CN-1000" (counter seeded in migration 008). `db` lets a caller
 * mint on ITS OWN transaction (scripts/backfill-orders.ts creates every order in one) so a rollback burns
 * no number; default = the pool, as issueRef.
 */
export async function issueConsignmentNumber(db: Pick<PoolClient, 'query'> = pool): Promise<string> {
  const { rows } = await db.query(
    `UPDATE ref_counters SET next_val = next_val + 1 WHERE prefix = 'CN' RETURNING next_val - 1 AS val`,
  );
  return `CN-${rows[0].val}`;
}

/**
 * Harriet (2026-09-10): a deleted sample's ref may be reused PROVIDED it was the latest number for its
 * prefix — SL-7491 deleted while the counter stands at 7492 hands 7491 back; deleting SL-7480 moves
 * nothing. Runs on the soft-delete's own transaction. Returns whether the counter stepped back.
 * Round 10: the lot goes with the last send — once no live row in either book carries the ref, the ref
 * no longer names a coffee (any ref shape, not only the counter-issued ones).
 */
export async function releaseRefIfLatest(db: Pick<PoolClient, 'query'>, ref: string | null | undefined): Promise<boolean> {
  await releaseLotIfOrphaned(db, ref);
  const m = /^(SL|TYPE|SSKE)-(\d+)$/.exec((ref ?? '').trim());
  if (!m) return false;
  const { rowCount } = await db.query(
    `UPDATE ref_counters SET next_val = next_val - 1 WHERE prefix = $1 AND next_val = $2::int + 1`,
    [m[1], Number(m[2])],
  );
  return (rowCount ?? 0) > 0;
}
