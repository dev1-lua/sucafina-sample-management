import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError, h } from '../errors.js';
import { normalizeRef } from '../lib/lots.js';

// GET /samples/resolve (round 10, contracts §5): a ref → its live rows, so the agent can ask "which send?"
// when several share the ref. Mounted at /samples BEFORE the legacy samples router, whose /:id would
// otherwise swallow the path.

export const samplesResolve = Router();

const TABS = ['specialty', 'bulk', 'forwarding'];

samplesResolve.get('/resolve', h(async (req, res) => {
  const ref = normalizeRef(String(req.query.ref ?? ''));
  if (!ref) throw new HttpError(400, 'ref is required');
  const where = ['v.deleted_at IS NULL', 'normalize_ref(v.ref) = $1'];
  const params: unknown[] = [ref];
  const tab = String(req.query.tab ?? '').trim();
  if (tab) {
    if (!TABS.includes(tab)) throw new HttpError(400, 'invalid tab');
    params.push(tab);
    where.push(`v.tab = $${params.length}`);
  }
  const receiver = String(req.query.receiver ?? '').trim();
  if (receiver) {
    params.push(receiver);
    where.push(`(v.receiver ILIKE '%'||$${params.length}||'%'
                 OR EXISTS (SELECT 1 FROM clients c WHERE c.id = v.client_id AND c.name ILIKE '%'||$${params.length}||'%'))`);
  }
  const { rows } = await pool.query(
    `SELECT v.tab, v.id, v.ref, v.title, v.receiver, v.status::text AS status, v.date_on,
            v.consignment_number, v.awb, v.courier_norm
       FROM all_samples_v v
      WHERE ${where.join(' AND ')}
      ORDER BY v.date_on DESC NULLS LAST, v.created_at DESC
      LIMIT 50`,
    params,
  );
  res.json({ ref, candidates: rows });
}));
