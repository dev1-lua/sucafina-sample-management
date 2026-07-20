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
  // sample_type_norm and country are free text in the unified view, so match by CSV membership
  // (no enum assert) — lets the agent filter a cross-book list by e.g. offer / Kenya. Country is
  // matched case-insensitively so Kenya/KENYA/kenya all match.
  if (req.query.sample_type) {
    const values = String(req.query.sample_type).split(',').map((s) => s.trim()).filter(Boolean);
    if (values.length) f.add(`sample_type_norm = ANY (?::text[])`, values);
  }
  if (req.query.country) {
    const values = String(req.query.country).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (values.length) f.add(`lower(country) = ANY (?::text[])`, values);
  }

  // Paginated like the per-table list endpoints (see lib/list.ts): `page` is 1-based,
  // `pageSize` clamped ≤100. `total` is the true match count (window fn), so a caller can
  // page until it has all `total` rows — search used to expose only the first page.
  const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clampInt(req.query.pageSize, 50, 1, 100);
  const whereSql = f.where.length ? `WHERE ${f.where.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT tab, id, ref, title, receiver, country, sample_type_norm, qty_grams,
       status, courier_norm, awb, date_on, delivery_on, result_norm, phyto_cert,
       count(*) OVER ()::int AS full_count
     FROM all_samples_v ${whereSql}
     ORDER BY date_on DESC NULLS LAST, id ASC
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    f.params,
  );
  const total = rows[0]?.full_count ?? 0;
  res.json({ data: rows.map(({ full_count, ...r }) => r), total, page, pageSize });
}));
