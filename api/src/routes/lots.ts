import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { clampInt } from '../lib/validate.js';
import { findLot, liveSends, lotRefFor, resolveLot } from '../lib/lots.js';

// Lots = coffees (round 10, contracts §1–3). A ref names a coffee; its sends are the sample rows sharing it.
// Round 10b: an SSKE ref's lot is its contract (lot_ref) — the options A, B, C … of one contract are one group
// row here, with `options` (distinct letters, A→Z) and `contract_client`; the sends keep their lettered refs.

export const lots = Router();

const BOOKS = ['specialty', 'commercial'] as const;

const resolveSchema = z.object({
  book: z.enum(BOOKS),
  ref: z.string().nullish(),
  outturn: z.string().nullish(),
  grade: z.string().nullish(),
  quality: z.string().nullish(),
  blend: z.string().nullish(),
  sample_type: z.string().nullish(),
});

// Pure read: what a create with this ref / coffee would do (reuse / new / conflict).
lots.post('/resolve', h(async (req, res) => {
  const body = parseBody(resolveSchema, req.body);
  res.json(await resolveLot(pool, body));
}));

const SORTABLE = ['last_send_on', 'ref', 'sends', 'first_issued_at', 'quality', 'outturn', 'grade', 'book'] as const;

// Live sends of both books keyed by LOT ref — the roll-up source for the list. option_letter falls back to
// the letter in the ref (legacy PSS rows carry none in the column).
const SENDS_CTE = `
  sends AS (
    SELECT lot_ref(ref) AS ref, receiver_company AS receiver, status::text AS status, date_on, created_at,
           COALESCE(option_letter, ref_option_letter(ref)) AS option_letter, contract_id
      FROM specialty_samples WHERE deleted_at IS NULL AND COALESCE(btrim(ref), '') <> ''
    UNION ALL
    SELECT lot_ref(sample_ref), client, status::text, date_on, created_at,
           COALESCE(option_letter, ref_option_letter(sample_ref)), contract_id
      FROM bulk_samples WHERE deleted_at IS NULL AND COALESCE(btrim(sample_ref), '') <> ''
  )`;

const part = (n: number, label: string) => (n > 0 ? `${n} ${label}` : null);

/** "2 delivered · 1 dispatched · 1 pending" — zero buckets omitted. */
function statusRollup(r: { delivered_sends: number; dispatched_sends: number; pending_sends: number; cancelled_sends: number }): string {
  const parts = [
    part(r.delivered_sends, 'delivered'), part(r.dispatched_sends, 'dispatched'),
    part(r.pending_sends, 'pending'), part(r.cancelled_sends, 'cancelled'),
  ].filter((p): p is string => !!p);
  return parts.length ? parts.join(' · ') : 'no sends';
}

lots.get('/', h(async (req, res) => {
  const where: string[] = [];
  const params: unknown[] = [];
  if (req.query.book) {
    const book = String(req.query.book);
    if (!(BOOKS as readonly string[]).includes(book)) throw new HttpError(400, 'invalid book');
    params.push(book);
    where.push(`l.book = $${params.length}`);
  }
  const q = String(req.query.q ?? '').trim();
  if (q) {
    params.push(q);
    const i = params.length;
    // The parent lot is kept when any of its live sends' receivers matches; a typed option (SSKE-104929A) finds its group.
    where.push(`(l.ref ILIKE '%'||$${i}||'%' OR l.ref = lot_ref($${i}) OR l.quality ILIKE '%'||$${i}||'%' OR l.outturn ILIKE '%'||$${i}||'%'
                 OR l.grade ILIKE '%'||$${i}||'%' OR l.blend ILIKE '%'||$${i}||'%'
                 OR EXISTS (SELECT 1 FROM sends sq WHERE sq.ref = l.ref AND sq.receiver ILIKE '%'||$${i}||'%'))`);
  }
  const sort = (SORTABLE as readonly string[]).includes(String(req.query.sort)) ? String(req.query.sort) : 'last_send_on';
  const orderQ = String(req.query.order ?? '').toLowerCase();
  const order = orderQ === 'asc' ? 'ASC' : orderQ === 'desc' ? 'DESC' : (sort === 'last_send_on' || sort === 'first_issued_at' || sort === 'sends' ? 'DESC' : 'ASC');
  const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clampInt(req.query.pageSize, 25, 1, 100);

  const { rows } = await pool.query(
    `WITH ${SENDS_CTE},
     agg AS (
       SELECT l.*,
              count(s.ref)::int AS sends,
              count(*) FILTER (WHERE s.status IN ('requested','preparing','dispatched'))::int AS open_sends,
              count(*) FILTER (WHERE s.status IN ('delivered','results_in'))::int AS delivered_sends,
              count(*) FILTER (WHERE s.status = 'dispatched')::int AS dispatched_sends,
              count(*) FILTER (WHERE s.status IN ('requested','preparing'))::int AS pending_sends,
              count(*) FILTER (WHERE s.status = 'cancelled')::int AS cancelled_sends,
              max(s.date_on) AS last_send_on,
              (array_agg(s.receiver ORDER BY s.date_on DESC NULLS LAST, s.created_at DESC))[1] AS last_receiver,
              COALESCE(array_remove(array_agg(DISTINCT s.option_letter), NULL), '{}') AS options,
              (array_agg(s.contract_id ORDER BY s.date_on DESC NULLS LAST, s.created_at DESC) FILTER (WHERE s.contract_id IS NOT NULL))[1] AS contract_id
         FROM lots l LEFT JOIN sends s ON s.ref = l.ref
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        GROUP BY l.ref
     )
     SELECT agg.*, count(*) OVER ()::int AS full_count,
            (SELECT c.client_name FROM contracts c WHERE c.id = agg.contract_id) AS contract_client
       FROM agg
     ORDER BY ${sort} ${order} NULLS LAST, ref ASC
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params,
  );
  const total = rows[0]?.full_count ?? 0;
  const data = rows.map(({ full_count, dispatched_sends, pending_sends, cancelled_sends, contract_id, options, ...r }) => ({
    ...r, options: [...(options as string[])].sort(), status_rollup: statusRollup({ ...r, dispatched_sends, pending_sends, cancelled_sends }),
  }));
  res.json({ data, total, page, pageSize });
}));

// The base (SSKE-104929) or any option (SSKE-104929A) of a PSS group both open the group.
lots.get('/:ref', h(async (req, res) => {
  const ref = lotRefFor(req.params.ref);
  const lot = await findLot(pool, ref);
  if (!lot) throw new HttpError(404, 'lot not found');
  res.json({ lot, sends: await liveSends(pool, ref, { limit: 100 }) });
}));
