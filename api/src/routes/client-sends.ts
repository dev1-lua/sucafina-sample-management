import { Router } from 'express';
import { pool } from '../db.js';
import { HttpError, h } from '../errors.js';
import { clampInt } from '../lib/validate.js';
import { statusRollup } from './lots.js';

// Clients view (round 11 §3, Ivo/Harriet/Daniel 2026-09-28): one row per CLIENT with every coffee sent to
// them — the reading of the books the desk kept asking for ("which coffees went to Torch?"). Specialty and
// Commercial only; Forwarding keeps its Sends table.
//
// Source: live rows of all_samples_v for one book. Commercial rows often carry no client_id and only the
// `client` text (the view exposes it as `receiver`), so the group key is COALESCE('id:' || client_id,
// 'name:' || lower(btrim(receiver))); a row with neither groups under 'name:(no client)'.

export const clientSends = Router();

const BOOKS: Record<string, string> = { specialty: 'specialty', commercial: 'bulk' };

function tabFor(book: unknown): string {
  const tab = BOOKS[String(book ?? '')];
  if (!tab) throw new HttpError(400, 'book must be specialty or commercial');
  return tab;
}

// Every live send of the book with its client key and display name. $1 = the view tab.
const SENDS_CTE = `
  sends AS (
    SELECT v.tab, v.id, v.send_id, v.ref, v.option_letter, v.title, v.qty_grams, v.date_on, v.created_at,
           v.status::text AS status, v.courier_norm, v.awb, v.result_norm::text AS result_norm,
           v.consignment_number, v.lot_sends, v.client_id,
           COALESCE('id:' || v.client_id::text, 'name:' || NULLIF(lower(btrim(v.receiver)), ''), 'name:(no client)') AS key,
           COALESCE(c.name, NULLIF(btrim(v.receiver), ''), '(no client)') AS client_name
      FROM all_samples_v v LEFT JOIN clients c ON c.id = v.client_id
     WHERE v.deleted_at IS NULL AND v.tab = $1
  )`;

const SORTABLE = ['client_name', 'sends', 'coffees', 'last_send_on', 'open_sends'] as const;

clientSends.get('/', h(async (req, res) => {
  const params: unknown[] = [tabFor(req.query.book)];
  const where: string[] = [];
  const q = String(req.query.q ?? '').trim();
  if (q) {
    params.push(q);
    const i = params.length;
    where.push(`(agg.client_name ILIKE '%'||$${i}||'%'
                 OR EXISTS (SELECT 1 FROM sends sq WHERE sq.key = agg.key AND (sq.ref ILIKE '%'||$${i}||'%' OR sq.send_id ILIKE '%'||$${i}||'%')))`);
  }
  // `client=` is the exact client name (case/whitespace-insensitive), independent of `q`: the Sends table's
  // client link (?view=clients&client=Torch Coffee) must open THAT client, not every "Torch…" the fuzzy q finds.
  const client = String(req.query.client ?? '').trim();
  if (client) {
    params.push(client);
    where.push(`lower(btrim(agg.client_name)) = lower(btrim($${params.length}))`);
  }
  const sort = (SORTABLE as readonly string[]).includes(String(req.query.sort)) ? String(req.query.sort) : 'last_send_on';
  const orderQ = String(req.query.order ?? '').toLowerCase();
  const order = orderQ === 'asc' ? 'ASC' : orderQ === 'desc' ? 'DESC' : (sort === 'client_name' ? 'ASC' : 'DESC');
  const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clampInt(req.query.pageSize, 25, 1, 100);

  const { rows } = await pool.query(
    `WITH ${SENDS_CTE},
     agg AS (
       SELECT s.key,
              (array_agg(s.client_id) FILTER (WHERE s.client_id IS NOT NULL))[1] AS client_id,
              (array_agg(s.client_name ORDER BY s.date_on DESC NULLS LAST, s.created_at DESC))[1] AS client_name,
              count(*)::int AS sends,
              count(DISTINCT lot_ref(s.ref)) FILTER (WHERE COALESCE(btrim(s.ref), '') <> '')::int AS coffees,
              count(*) FILTER (WHERE s.status IN ('requested','preparing'))::int AS open_sends,
              count(*) FILTER (WHERE s.status = 'dispatched')::int AS in_transit,
              count(*) FILTER (WHERE s.status IN ('delivered','results_in'))::int AS delivered_sends,
              count(*) FILTER (WHERE s.status IN ('delivered','results_in') AND s.result_norm IS NULL)::int AS awaiting_results,
              count(*) FILTER (WHERE s.result_norm = 'approved')::int AS approved,
              count(*) FILTER (WHERE s.result_norm = 'rejected')::int AS rejected,
              count(*) FILTER (WHERE s.status = 'cancelled')::int AS cancelled_sends,
              max(s.date_on) AS last_send_on,
              (array_agg(s.ref ORDER BY s.date_on DESC NULLS LAST, s.created_at DESC))[1] AS last_ref
         FROM sends s
        GROUP BY s.key
     )
     SELECT agg.*, count(*) OVER ()::int AS full_count
       FROM agg
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${sort} ${order} NULLS LAST, client_name ASC, key ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params,
  );
  const total = rows[0]?.full_count ?? 0;
  const data = rows.map(({ full_count, cancelled_sends, ...r }) => ({
    ...r,
    // Same buckets as /lots: delivered / dispatched / pending / cancelled.
    status_rollup: statusRollup({ delivered_sends: r.delivered_sends, dispatched_sends: r.in_transit, pending_sends: r.open_sends, cancelled_sends }),
  }));
  res.json({ data, total, page, pageSize });
}));

// The key exactly as the list row gave it (URL-encoded by the caller; express decodes the param).
clientSends.get('/:key', h(async (req, res) => {
  const tab = tabFor(req.query.book);
  const key = String(req.params.key ?? '');
  if (!/^(id:|name:)./.test(key)) throw new HttpError(400, 'key must be id:<client id> or name:<receiver>');
  const { rows } = await pool.query(
    `WITH ${SENDS_CTE}
     SELECT s.tab, s.id, s.send_id, s.ref, s.option_letter, s.title, s.qty_grams, s.date_on, s.status,
            s.courier_norm, s.awb, s.result_norm, s.consignment_number, s.lot_sends, s.client_id, s.client_name
       FROM sends s
      WHERE s.key = $2
      ORDER BY s.date_on DESC NULLS LAST, s.created_at DESC`,
    [tab, key],
  );
  let client: { key: string; client_id: string | null; client_name: string } | null = null;
  if (rows[0]) {
    client = { key, client_id: rows[0].client_id ?? null, client_name: rows[0].client_name };
  } else if (key.startsWith('id:')) {
    // A client on file with no send in this book yet: an empty list, not a 404.
    const id = key.slice(3);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'invalid client id');
    const c = await pool.query(`SELECT id, name FROM clients WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (c.rows[0]) client = { key, client_id: String(c.rows[0].id), client_name: String(c.rows[0].name) };
  }
  if (!client) throw new HttpError(404, 'client not found');
  res.json({
    client,
    sends: rows.map(({ client_id, client_name, ...s }) => s),
  });
}));
