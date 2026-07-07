import { Router } from 'express';
import { pool } from '../db.js';
import { h } from '../errors.js';
import { makeFilters } from '../lib/list.js';
import { assertIn, clampInt } from '../lib/validate.js';

export const search = Router();

const TABS = ['specialty', 'bulk', 'forwarding'];
// specialty's superset of statuses (bulk shares it; forwarding excludes results_in)
const STATUSES = ['requested', 'preparing', 'dispatched', 'delivered', 'results_in', 'cancelled'];

search.get('/', h(async (req, res) => {
  const f = makeFilters();
  f.where.push('deleted_at IS NULL');

  const q = String(req.query.q ?? '').trim();
  if (q) {
    f.params.push(q);
    const i = f.params.length;
    f.where.push(`(ref ILIKE '%'||$${i}||'%' OR title ILIKE '%'||$${i}||'%' OR receiver ILIKE '%'||$${i}||'%' OR awb ILIKE '%'||$${i}||'%')`);
  }
  if (req.query.tab && TABS.includes(String(req.query.tab))) f.add(`tab = ?`, String(req.query.tab));
  if (req.query.status) {
    const values = String(req.query.status).split(',');
    for (const v of values) assertIn(v, STATUSES, 'status');
    f.add(`status = ANY (?::sample_status_t[])`, values);
  }
  if (req.query.awb) f.add(`awb = ?`, String(req.query.awb));

  const pageSize = clampInt(req.query.pageSize, 50, 1, 100);
  const whereSql = f.where.length ? `WHERE ${f.where.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT tab, id, ref, title, receiver, status, courier_norm, awb, date_on, delivery_on, result_norm,
       count(*) OVER ()::int AS full_count
     FROM all_samples_v ${whereSql}
     ORDER BY date_on DESC NULLS LAST, id ASC LIMIT ${pageSize}`,
    f.params,
  );
  const total = rows[0]?.full_count ?? 0;
  res.json({ data: rows.map(({ full_count, ...r }) => r), total });
}));
