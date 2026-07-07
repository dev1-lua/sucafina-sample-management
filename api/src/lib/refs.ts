import { pool } from '../db.js';

const PREFIX: Record<string, string> = { pss: 'SSKE', type: 'TYPE' };

export async function issueRef(sampleType: string): Promise<string> {
  const prefix = PREFIX[sampleType] ?? 'SL';
  const { rows } = await pool.query(
    `UPDATE ref_counters SET next_val = next_val + 1 WHERE prefix = $1 RETURNING next_val - 1 AS val`,
    [prefix]
  );
  return `${prefix}-${rows[0].val}`;
}
