import { pool } from '../db.js';

const SUMMARY = `id, ref, sample_type, quality, receiver, deadline, awb, dispatched_at, delivered_at`;
const PSS_FIRST = `ORDER BY (sample_type = 'pss') DESC, deadline ASC NULLS LAST, coalesce(requested_at, created_at) ASC LIMIT 50`;

export type Digest = {
  generated_at: string;
  buckets: Record<'not_dispatched' | 'no_delivery_confirmation' | 'awaiting_results',
    { count: number; items: Record<string, unknown>[] }>;
};

async function bucket(whereSql: string): Promise<{ count: number; items: Record<string, unknown>[] }> {
  const count = await pool.query(`SELECT count(*)::int AS n FROM samples WHERE ${whereSql}`);
  const items = await pool.query(`SELECT ${SUMMARY} FROM samples WHERE ${whereSql} ${PSS_FIRST}`);
  return { count: count.rows[0].n, items: items.rows };
}

export async function computeDigest(): Promise<Digest> {
  return {
    generated_at: new Date().toISOString(),
    buckets: {
      not_dispatched: await bucket(
        `status IN ('requested','preparing') AND (deadline < CURRENT_DATE OR (deadline IS NULL AND coalesce(requested_at, created_at) < now() - interval '3 days'))`),
      no_delivery_confirmation: await bucket(
        `status = 'dispatched' AND dispatched_at < now() - interval '5 days'`),
      awaiting_results: await bucket(
        `status = 'delivered' AND result IS NULL AND delivered_at < now() - interval '7 days'`),
    },
  };
}
