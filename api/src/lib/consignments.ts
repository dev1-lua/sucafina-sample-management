import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';

// Orders = consignments (migration 023, round 10): a CN-#### groups the sends of one request to one client.
// Shared by the three sample routers (create with `consignment_id`, `?consignment=` filters) and
// routes/consignments.ts.

type Db = Pick<PoolClient, 'query'> | typeof pool;

export type ConsignmentRef = { id: string; number: string };

export const TABS = ['specialty', 'bulk', 'forwarding'] as const;
export type Tab = (typeof TABS)[number];
export const TABLE: Record<Tab, string> = {
  specialty: 'specialty_samples',
  bulk: 'bulk_samples',
  forwarding: 'forwarding_samples',
};

/** Live member count summed across the three sample tables (soft-deleted rows excluded), for alias `c`. */
export const MEMBER_COUNT = `
  (SELECT count(*) FROM specialty_samples s  WHERE s.consignment_id  = c.id AND s.deleted_at  IS NULL)
+ (SELECT count(*) FROM bulk_samples b       WHERE b.consignment_id  = c.id AND b.deleted_at  IS NULL)
+ (SELECT count(*) FROM forwarding_samples f WHERE f.consignment_id  = c.id AND f.deleted_at  IS NULL)`;

/**
 * derived_status for alias `c` (contracts §6): closed when the row says so; delivered when every member is
 * delivered; dispatched when every member has dispatched_on / an AWB (or a dispatched-or-later status);
 * partly_dispatched when some; else requested. Cancelled members are out of the count.
 */
export const DERIVED_STATUS = `
  (SELECT CASE WHEN c.status = 'closed' THEN 'closed'
               WHEN m.total = 0 THEN 'requested'
               WHEN m.delivered = m.total THEN 'delivered'
               WHEN m.dispatched = m.total THEN 'dispatched'
               WHEN m.dispatched > 0 THEN 'partly_dispatched'
               ELSE 'requested' END
     FROM (SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE u.status IN ('delivered','results_in'))::int AS delivered,
                  count(*) FILTER (WHERE u.dispatched_on IS NOT NULL OR COALESCE(u.awb, '') <> ''
                                      OR u.status IN ('dispatched','delivered','results_in'))::int AS dispatched
             FROM (SELECT status, dispatched_on, awb FROM specialty_samples  WHERE consignment_id = c.id AND deleted_at IS NULL AND status <> 'cancelled'
                   UNION ALL
                   SELECT status, dispatched_on, awb FROM bulk_samples       WHERE consignment_id = c.id AND deleted_at IS NULL AND status <> 'cancelled'
                   UNION ALL
                   SELECT status, dispatched_on, awb FROM forwarding_samples WHERE consignment_id = c.id AND deleted_at IS NULL AND status <> 'cancelled') u) m)`;

export type Member = {
  tab: Tab; id: string; ref: string | null; title: string | null; receiver: string | null; status: string;
  location: string | null; outturn: string | null; grade: string | null; sample_type_norm: string | null;
  qty_grams: number | null; awb: string | null; courier_norm: string | null; dispatched_on: string | null; date_on: string | null;
};

/** Member samples across the three books, in one unified shape (forwarding: NULL for what it lacks). */
export async function memberRows(db: Db, consignmentId: string): Promise<Member[]> {
  const { rows } = await db.query(
    `SELECT 'specialty'::text AS tab, id, ref AS ref, description AS title, receiver_company AS receiver, status::text AS status, location,
            outturn, grade, sample_type_norm, qty_grams, awb, courier_norm, dispatched_on, date_on
       FROM specialty_samples  WHERE consignment_id = $1 AND deleted_at IS NULL
     UNION ALL
     SELECT 'bulk', id, sample_ref, quality, client, status::text, location,
            NULL, NULL, sample_type_norm, qty_grams, awb, courier_norm, dispatched_on, date_on
       FROM bulk_samples       WHERE consignment_id = $1 AND deleted_at IS NULL
     UNION ALL
     SELECT 'forwarding', id, sample_ref, coffee_quality, receiver_company, status::text, location,
            NULL, NULL, NULL, qty_grams, awb, courier_norm, dispatched_on, date_on
       FROM forwarding_samples WHERE consignment_id = $1 AND deleted_at IS NULL
     ORDER BY tab, ref`,
    [consignmentId],
  );
  return rows as Member[];
}

/**
 * Attach live samples of one book to an order and stamp the order onto their still-pending `created`
 * outbox rows (contracts §8), so QC's new-request ping can group by order. Runs on the caller's
 * transaction. Returns the ids actually attached (unknown / deleted ids are skipped, as before).
 */
export async function attachSamples(db: Db, c: ConsignmentRef, tab: Tab, ids: string[], actor: string): Promise<string[]> {
  const upd = await db.query(
    `UPDATE ${TABLE[tab]} SET consignment_id = $1, updated_at = now()
      WHERE id = ANY($2::uuid[]) AND deleted_at IS NULL RETURNING id`,
    [c.id, ids],
  );
  const attached = upd.rows.map((r) => String(r.id));
  if (attached.length) {
    await db.query(
      `UPDATE notifications_outbox
          SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('consignment_id', $2::text, 'consignment_number', $3::text)
        WHERE tab = $4 AND sample_id = ANY($1::uuid[]) AND event = 'created' AND sent_at IS NULL`,
      [attached, c.id, c.number, tab],
    );
  }
  await db.query(
    `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('consignment', $1, 'edited', $2, $3)`,
    [c.id, `added ${attached.length} ${tab} sample(s)`, actor],
  );
  return attached;
}

/** Detach samples from an order (clears consignment_id and the order on their pending `created` pings). */
export async function detachSamples(db: Db, consignmentId: string, tab: Tab, ids: string[], actor: string): Promise<string[]> {
  const upd = await db.query(
    `UPDATE ${TABLE[tab]} SET consignment_id = NULL, updated_at = now()
      WHERE id = ANY($2::uuid[]) AND consignment_id = $1 RETURNING id`,
    [consignmentId, ids],
  );
  const detached = upd.rows.map((r) => String(r.id));
  if (detached.length) {
    await db.query(
      `UPDATE notifications_outbox
          SET payload = NULLIF(COALESCE(payload, '{}'::jsonb) - 'consignment_id' - 'consignment_number', '{}'::jsonb)
        WHERE tab = $2 AND sample_id = ANY($1::uuid[]) AND event = 'created' AND sent_at IS NULL`,
      [detached, tab],
    );
  }
  await db.query(
    `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('consignment', $1, 'edited', $2, $3)`,
    [consignmentId, `removed ${detached.length} ${tab} sample(s)`, actor],
  );
  return detached;
}

/** The live consignment behind an id, or a 400 — a sample must never point at a missing or deleted order. */
export async function assertConsignment(db: Db, id: string): Promise<ConsignmentRef> {
  const { rows } = await db.query(`SELECT id, number FROM consignments WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows[0]) throw new HttpError(400, 'consignment not found');
  return rows[0] as ConsignmentRef;
}

/**
 * WHERE fragment for `?consignment=` (a CN number or the consignment's uuid). The book tables carry
 * `consignment_id`; all_samples_v carries only `consignment_number` — `by` says which the caller has.
 * Appends the one parameter itself: the value is used twice.
 */
export function consignmentWhere(f: { where: string[]; params: unknown[] }, raw: string, by: 'id' | 'number' = 'id'): void {
  f.params.push(raw.trim());
  const i = f.params.length;
  const col = by === 'id' ? 'consignment_id' : 'consignment_number';
  f.where.push(`${col} IN (SELECT cn.${by} FROM consignments cn WHERE upper(cn.number) = upper($${i}) OR cn.id::text = $${i})`);
}
