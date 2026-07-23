import { pool } from '../db.js';

// Sample-type → ref prefix. pss=Shipment Sample Kenya, type=Type sample; everything else
// (offer, specialty lots, woc, retention, …) falls back to SL. Every prefix here must have a
// seeded row in ref_counters (migration 001) or issueRef throws on the missing counter row.
const PREFIX: Record<string, string> = { pss: 'SSKE', type: 'TYPE' };

export async function issueRef(sampleType: string): Promise<string> {
  const prefix = PREFIX[sampleType] ?? 'SL';
  const { rows } = await pool.query(
    `UPDATE ref_counters SET next_val = next_val + 1 WHERE prefix = $1 RETURNING next_val - 1 AS val`,
    [prefix]
  );
  return `${prefix}-${rows[0].val}`;
}

/** Mint the next consignment number, e.g. "CN-1000" (counter seeded in migration 008). */
export async function issueConsignmentNumber(): Promise<string> {
  const { rows } = await pool.query(
    `UPDATE ref_counters SET next_val = next_val + 1 WHERE prefix = 'CN' RETURNING next_val - 1 AS val`,
  );
  return `CN-${rows[0].val}`;
}
