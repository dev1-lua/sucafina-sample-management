import { pool } from '../db.js';

const SUMMARY = `tab, id, ref, title AS quality, receiver, awb, date_on, delivery_on`;
const ORDER = `ORDER BY date_on ASC NULLS LAST LIMIT 50`;

export type DigestItem = { tab: string; id: string; [k: string]: unknown };
export type Digest = {
  generated_at: string;
  buckets: Record<'not_dispatched' | 'no_delivery_confirmation' | 'awaiting_results',
    { count: number; items: DigestItem[] }>;
};

async function bucket(whereSql: string): Promise<{ count: number; items: DigestItem[] }> {
  const base = `FROM all_samples_v WHERE deleted_at IS NULL AND ${whereSql}`;
  const count = await pool.query(`SELECT count(*)::int AS n ${base}`);
  const items = await pool.query(`SELECT ${SUMMARY} ${base} ${ORDER}`);
  return { count: count.rows[0].n, items: items.rows };
}

export async function computeDigest(): Promise<Digest> {
  return {
    generated_at: new Date().toISOString(),
    buckets: {
      not_dispatched: await bucket(
        `status IN ('requested','preparing') AND (date_on IS NULL OR date_on < CURRENT_DATE - interval '3 days')`),
      no_delivery_confirmation: await bucket(
        `status = 'dispatched' AND date_on < CURRENT_DATE - interval '5 days'`),
      // Forwarding excluded: it never carries a result and is out of the awaiting-results lifecycle
      awaiting_results: await bucket(
        `status = 'delivered' AND result_norm IS NULL AND tab <> 'forwarding' AND coalesce(delivery_on, date_on) < CURRENT_DATE - interval '7 days'`),
    },
  };
}
