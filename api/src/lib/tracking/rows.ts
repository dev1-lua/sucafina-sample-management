import { pool } from '../../db.js';

export type SampleTab = 'specialty' | 'bulk' | 'forwarding';

export type TrackedRow = {
  tab: SampleTab;
  id: string;
  ref: string | null;
  awb: string;
  courier_norm: string | null;
  status: string;
  client_id: string | null;
  dispatched_on: string | null;
  date_on: string | null;
  tracking_status: string | null;
  tracking_last_event: string | null;
  tracking_checked_at: string | null;
  has_delivery_on: boolean;
};

// Three-table UNION over the books. `deleted_at`/`created_at` ride along for the WHERE/ORDER
// clauses of the two queries below but are never projected into a TrackedRow.
const UNION_SQL = `
  SELECT 'specialty'::text AS tab, t.id::text AS id, t.ref AS ref, t.awb, t.courier_norm,
         t.status::text AS status, t.client_id::text AS client_id, t.dispatched_on, t.date_on,
         t.tracking_status, t.tracking_last_event, t.tracking_checked_at, true AS has_delivery_on,
         t.created_at, t.deleted_at
    FROM specialty_samples t
  UNION ALL
  SELECT 'bulk'::text, t.id::text, t.sample_ref, t.awb, t.courier_norm,
         t.status::text, t.client_id::text, t.dispatched_on, t.date_on,
         t.tracking_status, t.tracking_last_event, t.tracking_checked_at, true,
         t.created_at, t.deleted_at
    FROM bulk_samples t
  UNION ALL
  SELECT 'forwarding'::text, t.id::text, t.sample_ref, t.awb, t.courier_norm,
         t.status::text, t.client_id::text, t.dispatched_on, t.date_on,
         t.tracking_status, t.tracking_last_event, t.tracking_checked_at, false,
         t.created_at, t.deleted_at
    FROM forwarding_samples t
`;

/**
 * Every non-deleted row (any tab, any status) whose AWB matches `awb` — exactly, or in
 * digits-only form so an agent-normalised number ("9620551651") still finds a dashboard-typed
 * one ("962-055-1651"). Dispatched rows sort first, then newest date_on.
 */
export async function rowsByAwb(awb: string): Promise<TrackedRow[]> {
  const digits = awb.replace(/\D/g, '');
  const { rows } = await pool.query(
    `SELECT tab, id, ref, awb, courier_norm, status, client_id, dispatched_on, date_on,
            tracking_status, tracking_last_event, tracking_checked_at, has_delivery_on
       FROM (${UNION_SQL}) x
      WHERE deleted_at IS NULL
        AND (awb = $1 OR ($2 <> '' AND regexp_replace(awb, '\\D', '', 'g') = $2))
      ORDER BY (status = 'dispatched') DESC, date_on DESC NULLS LAST`,
    [awb, digits],
  );
  return rows;
}

/**
 * The sweep pool: dispatched rows on a tracked courier (dhl/fedex), with an AWB, inside the
 * 60-day window, not checked within `minAgeHours`. Oldest-checked (or never-checked) first.
 * `remaining` is the pool total minus what this call returned — the caller can loop until 0.
 */
export async function sweepPool(o: { limit: number; minAgeHours: number }): Promise<{ rows: TrackedRow[]; remaining: number }> {
  const { rows } = await pool.query(
    `SELECT tab, id, ref, awb, courier_norm, status, client_id, dispatched_on, date_on,
            tracking_status, tracking_last_event, tracking_checked_at, has_delivery_on,
            count(*) OVER ()::int AS full_count
       FROM (${UNION_SQL}) x
      WHERE status = 'dispatched'
        AND awb <> ''
        AND lower(courier_norm) IN ('dhl', 'fedex')
        AND deleted_at IS NULL
        AND COALESCE(dispatched_on, date_on, created_at::date) >= current_date - 60
        AND (tracking_checked_at IS NULL OR tracking_checked_at < now() - make_interval(hours => $1))
      ORDER BY tracking_checked_at NULLS FIRST
      LIMIT $2`,
    [o.minAgeHours, o.limit],
  );
  const total = rows[0]?.full_count ?? 0;
  return {
    rows: rows.map(({ full_count, ...r }) => r) as TrackedRow[],
    remaining: Math.max(total - rows.length, 0),
  };
}
