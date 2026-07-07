import { Router } from 'express';
import { pool } from '../db.js';
import { h } from '../errors.js';

export const stats = Router();

const groupToMap = (rows: { k: string | null; n: number }[]): Record<string, number> => {
  const m: Record<string, number> = {};
  for (const r of rows) if (r.k != null) m[r.k] = r.n;
  return m;
};

stats.get('/', h(async (_req, res) => {
  const base = `FROM all_samples_v WHERE deleted_at IS NULL`;
  const [byStatus, byTab, bySampleType, byResult, byCourier, byCountry, volume, scalars] = await Promise.all([
    pool.query(`SELECT status AS k, count(*)::int AS n ${base} GROUP BY status`),
    pool.query(`SELECT tab AS k, count(*)::int AS n ${base} GROUP BY tab`),
    // sample_type_norm is not projected by the view (Forwarding has none); source it from the two tables that carry it
    pool.query(`
      SELECT sample_type_norm::text AS k, count(*)::int AS n FROM (
        SELECT sample_type_norm, deleted_at FROM specialty_samples
        UNION ALL
        SELECT sample_type_norm, deleted_at FROM bulk_samples
      ) t WHERE deleted_at IS NULL AND sample_type_norm IS NOT NULL GROUP BY sample_type_norm`),
    pool.query(`SELECT result_norm::text AS k, count(*)::int AS n ${base} AND result_norm IS NOT NULL GROUP BY result_norm`),
    pool.query(`SELECT courier_norm::text AS k, count(*)::int AS n ${base} AND courier_norm IS NOT NULL GROUP BY courier_norm`),
    pool.query(`SELECT country AS k, count(*)::int AS n ${base} AND country IS NOT NULL GROUP BY country ORDER BY n DESC LIMIT 15`),
    pool.query(`SELECT to_char(date_trunc('month', date_on), 'YYYY-MM') AS month, count(*)::int AS n
                ${base} AND date_on IS NOT NULL GROUP BY 1 ORDER BY 1`),
    pool.query(`
      SELECT
        (SELECT count(*)::int ${base} AND status = 'dispatched') AS in_transit,
        (SELECT count(*)::int ${base} AND status = 'delivered' AND result_norm IS NULL AND tab <> 'forwarding') AS awaiting_results,
        (SELECT count(*)::int ${base} AND status = 'delivered' AND result_norm IS NULL AND tab <> 'forwarding'
              AND coalesce(delivery_on, date_on) < CURRENT_DATE - interval '7 days') AS awaiting_results_aging,
        (SELECT count(*)::int ${base} AND created_at >= date_trunc('week', now())) AS dispatched_this_week
    `),
  ]);
  res.json({
    by_status: groupToMap(byStatus.rows),
    by_tab: groupToMap(byTab.rows),
    by_sample_type: groupToMap(bySampleType.rows),
    by_result: groupToMap(byResult.rows),
    by_courier: groupToMap(byCourier.rows),
    by_country: groupToMap(byCountry.rows),
    volume_over_time: volume.rows,
    ...scalars.rows[0],
  });
}));
