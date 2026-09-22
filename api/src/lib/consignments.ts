import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';

// Orders = consignments (migration 023, round 10): a CN-#### groups the sends of one request to one client.
// Shared by the three sample routers (create with `consignment_id`, `?consignment=` filters) and
// routes/consignments.ts.

type Db = Pick<PoolClient, 'query'> | typeof pool;

export type ConsignmentRef = { id: string; number: string };

/** The live consignment behind an id, or a 400 — a sample must never point at a missing or deleted order. */
export async function assertConsignment(db: Db, id: string): Promise<ConsignmentRef> {
  const { rows } = await db.query(`SELECT id, number FROM consignments WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows[0]) throw new HttpError(400, 'consignment not found');
  return rows[0] as ConsignmentRef;
}

/**
 * WHERE fragment for `?consignment=` (a CN number or the consignment's uuid). The book tables carry
 * `consignment_id`; all_samples_v carries only `consignment_number` — `by` says which the caller has.
 * Appends the one parameter itself: the value is used twice.
 */
export function consignmentWhere(f: { where: string[]; params: unknown[] }, raw: string, by: 'id' | 'number' = 'id'): void {
  f.params.push(raw.trim());
  const i = f.params.length;
  const col = by === 'id' ? 'consignment_id' : 'consignment_number';
  f.where.push(`${col} IN (SELECT cn.${by} FROM consignments cn WHERE upper(cn.number) = upper($${i}) OR cn.id::text = $${i})`);
}
