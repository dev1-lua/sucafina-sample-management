import { Router } from 'express';
import { pool } from '../db.js';
import { h } from '../errors.js';

export const stats = Router();

stats.get('/', h(async (_req, res) => {
  const byStatus = await pool.query(`SELECT status, count(*)::int AS n FROM samples GROUP BY status`);
  const scalars = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM samples
        WHERE status IN ('requested','preparing')
          AND (deadline < CURRENT_DATE OR (deadline IS NULL AND coalesce(requested_at, created_at) < now() - interval '3 days'))) AS overdue,
      (SELECT count(*)::int FROM samples WHERE status = 'dispatched') AS in_transit,
      (SELECT count(*)::int FROM samples WHERE status = 'delivered' AND result IS NULL) AS awaiting_results,
      (SELECT count(*)::int FROM samples WHERE dispatched_at >= date_trunc('week', now())) AS dispatched_this_week
  `);
  const by_status: Record<string, number> = {};
  for (const r of byStatus.rows) by_status[r.status] = r.n;
  res.json({ by_status, ...scalars.rows[0] });
}));
