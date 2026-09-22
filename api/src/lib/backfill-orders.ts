import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { issueConsignmentNumber } from './refs.js';
import { attachSamples, type Tab } from './consignments.js';

// Round 10b, task 3: rows logged before round 10 have no order (the dashboard's Order column reads "—"),
// e.g. Parlor Coffee's three coffees of 2026-09-02 that shared DHL AWB 8309842892. Rows that went out
// together — the same real AWB to the same client — are one consignment. scripts/backfill-orders.ts is the
// CLI (dry run by default); the whole apply is one transaction and a second apply is a no-op because every
// row it touched now carries a consignment_id.
//
// A "client" is the row's client_id; when that is null, the receiver text (receiver_company / client),
// compared case-insensitively, and then only WITHIN one table. Two books share one order only on a
// client_id + AWB match (one consignment may hold members of several books — attachSamples).
//
// The legacy sheet carries placeholder AWBs — "HD" (hand delivery) on 26 Connect Coffee rows, "n/a", "-" …
// Grouping on those would make bogus 26-member orders, so an AWB only counts when it holds four digits in a
// row; the rest are counted and reported as placeholders. It also shares one AWB across whole boxes back to
// 2023 (317 groups / 1771 rows on the dev seed), hence `since`: a date floor on COALESCE(date_on, the day
// logged) — rows before it neither form nor join a group. No floor by default.

export const BACKFILL_ORDERS_ACTOR = 'script:backfill-orders';

type Q = Pick<PoolClient, 'query'>;
type Pool = typeof pool;
type Book = Extract<Tab, 'specialty' | 'bulk'>;

export type GroupRow = { tab: Book; id: string; ref: string | null; awb: string; date: string | null };
export type OrderGroup = {
  awb: string;
  client_id: string | null;
  /** clients.name via client_id, else the receiver text as written on the first row. */
  client: string;
  rows: GroupRow[];
  /** Taken from the rows when every row agrees (non-empty and identical), else null. */
  requested_by: string | null;
  logged_by: string | null;
  /** min..max of date_on (falling back to the day the row was logged). */
  date_from: string | null;
  date_to: string | null;
  /** The CN number once applied; null on a dry run. */
  number: string | null;
};
export type Candidates = { groups: OrderGroup[]; placeholders: number };
export type BackfillReport = Candidates & { applied: boolean; rows: number; consignments: number; since: string | null };
export type BackfillOptions = { apply: boolean; actor?: string; since?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real AWB holds four digits in a row; "HD", "n/a", "ref 12" are placeholders. */
export const isRealAwb = (awb: string): boolean => /\d{4}/.test(awb);

type LiveRow = {
  tab: Book; id: string; ref: string | null; awb: string; client_id: string | null; receiver: string | null;
  client_name: string | null; requested_by: string | null; logged_by: string | null; date: string | null;
};

const LIVE_UNATTACHED_SQL = `
  SELECT live.*, cl.name AS client_name
    FROM (
      SELECT 'specialty'::text AS tab, id, ref, btrim(awb) AS awb, client_id, receiver_company AS receiver,
             requested_by, logged_by, COALESCE(date_on, created_at::date) AS date, created_at
        FROM specialty_samples
       WHERE deleted_at IS NULL AND consignment_id IS NULL AND COALESCE(btrim(awb), '') <> ''
         AND ($1::date IS NULL OR COALESCE(date_on, created_at::date) >= $1::date)
      UNION ALL
      SELECT 'bulk', id, sample_ref, btrim(awb), client_id, client,
             requested_by, logged_by, COALESCE(date_on, created_at::date), created_at
        FROM bulk_samples
       WHERE deleted_at IS NULL AND consignment_id IS NULL AND COALESCE(btrim(awb), '') <> ''
         AND ($1::date IS NULL OR COALESCE(date_on, created_at::date) >= $1::date)
    ) live
    LEFT JOIN clients cl ON cl.id = live.client_id
   ORDER BY live.awb, live.created_at, live.ref, live.id`;

const agreed = (values: Array<string | null>): string | null => {
  const set = new Set(values.map((v) => (v ?? '').trim()));
  if (set.size !== 1) return null;
  return [...set][0] || null;
};

/**
 * The orders the backfill would create: groups of 2+ live, unattached rows on one real AWB and one client,
 * dated on/after `since` when given. Pure read — the apply calls it again on its own transaction.
 */
export async function findOrderGroups(db: Q, o: { since?: string | null } = {}): Promise<Candidates> {
  const since = o.since ?? null;
  if (since !== null && !DATE_RE.test(since)) throw new Error(`since must be YYYY-MM-DD, got "${since}"`);
  const { rows } = await db.query(LIVE_UNATTACHED_SQL, [since]);
  let placeholders = 0;
  const byKey = new Map<string, LiveRow[]>();
  for (const r of rows as LiveRow[]) {
    if (!isRealAwb(r.awb)) { placeholders += 1; continue; }
    const awbKey = r.awb.toUpperCase();
    const key = r.client_id
      ? `${awbKey}|id:${r.client_id}`
      : `${awbKey}|${r.tab}|rx:${(r.receiver ?? '').trim().toLowerCase()}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }
  const groups: OrderGroup[] = [];
  for (const members of byKey.values()) {
    if (members.length < 2) continue;
    const first = members[0];
    const dates = members.map((m) => m.date).filter((d): d is string => !!d).sort();
    groups.push({
      awb: first.awb,
      client_id: first.client_id,
      client: (first.client_name ?? '').trim() || (first.receiver ?? '').trim() || '(no client)',
      rows: members.map((m) => ({ tab: m.tab, id: m.id, ref: m.ref, awb: m.awb, date: m.date })),
      requested_by: agreed(members.map((m) => m.requested_by)),
      logged_by: agreed(members.map((m) => m.logged_by)),
      date_from: dates[0] ?? null,
      date_to: dates[dates.length - 1] ?? null,
      number: null,
    });
  }
  return { groups, placeholders };
}

/**
 * Dry run: the groups, nothing written. Apply: ONE transaction creating, per group, a consignment (status
 * and location as POST /consignments defaults them — open, none), its `created` event and the members'
 * attachment (attachSamples stamps the order on any still-pending created pings too).
 */
export async function backfillOrders(db: Pool = pool, o: BackfillOptions): Promise<BackfillReport> {
  const actor = o.actor ?? BACKFILL_ORDERS_ACTOR;
  const since = o.since ?? null;
  const summarise = (c: Candidates, applied: boolean): BackfillReport => ({
    ...c, applied, since,
    rows: c.groups.reduce((n, g) => n + g.rows.length, 0),
    consignments: applied ? c.groups.length : 0,
  });
  if (!o.apply) return summarise(await findOrderGroups(db, { since }), false);

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const candidates = await findOrderGroups(client, { since });
    for (const g of candidates.groups) {
      const number = await issueConsignmentNumber(client);
      const { rows: [row] } = await client.query(
        `INSERT INTO consignments (number, location, status, notes, client_id, requested_by, logged_by)
         VALUES ($1, NULL, 'open', $2, $3::uuid, $4, $5) RETURNING id`,
        [number, `backfilled from AWB ${g.awb}`, g.client_id, g.requested_by, g.logged_by],
      );
      const id = String(row.id);
      await client.query(
        `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('consignment', $1, 'created', $2, $3)`,
        [id, `consignment ${number}`, actor],
      );
      const byTab = new Map<Book, string[]>();
      for (const r of g.rows) byTab.set(r.tab, [...(byTab.get(r.tab) ?? []), r.id]);
      for (const [tab, ids] of byTab) await attachSamples(client, { id, number }, tab, ids, actor);
      g.number = number;
    }
    await client.query('COMMIT');
    client.release();
    return summarise(candidates, true);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    client.release(e as Error);
    throw e;
  }
}
