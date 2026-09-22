import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { issueRef } from './refs.js';
import { coffeeKeyFor, describeCoffee, findLotByCoffee, normalizeRef, registerLot, type Book, type Coffee, type Lot } from './lots.js';
import { enqueueRequestEdited } from './change-alerts.js';

// A5 (round 10): migration 023 flagged, in `lot_conflicts`, every live row whose coffee disagrees with the
// lot its ref names (the TYPE-113 bug: one ref, two qualities). The lot keeps the ref on the OLDEST coffee;
// this module re-issues every other row — onto the ref of a lot that already names its coffee in this book
// when there is one, else a fresh counter ref (ONE per coffee across the whole run, not per group: Beyers'
// and Sarutahiko's AB FAQ rows flagged under TYPE-113 and TYPE-114 are the same coffee) — with an `edited`
// event and a request_edited change alert so QC sees the rename. scripts/lot-conflicts.ts is the CLI (dry
// run by default).

export const LOT_CONFLICTS_ACTOR = 'script:lot-conflicts';

type Db = Pick<PoolClient, 'query'> | typeof pool;
type Tab = 'specialty' | 'bulk';

const BOOK_OF: Record<Tab, Book> = { specialty: 'specialty', bulk: 'commercial' };
const REF_COL: Record<Tab, 'ref' | 'sample_ref'> = { specialty: 'ref', bulk: 'sample_ref' };
const TABLE: Record<Tab, string> = { specialty: 'specialty_samples', bulk: 'bulk_samples' };

export type ConflictRow = {
  ref: string;
  book: Book;
  tab: Tab;
  sample_id: string;
  // the coffee as detected by the migration
  coffee_key: string;
  quality: string | null;
  outturn: string | null;
  grade: string | null;
  detected_at: string;
  // the row today (live = not soft-deleted since detection)
  live: boolean;
  receiver: string | null;
  status: string | null;
  date_on: string | null;
};

export type ConflictGroup = { ref: string; lot: Lot | null; rows: ConflictRow[] };

/**
 * `lot_conflicts` grouped by ref, each with the lot on file and the rows' current state.
 * `onlyRefs` narrows a run to named refs (normalised) — fix TYPE-113 today, leave the legacy noise alone.
 */
export async function listLotConflicts(db: Db, o: { onlyRefs?: string[] } = {}): Promise<ConflictGroup[]> {
  const only = o.onlyRefs?.length ? new Set(o.onlyRefs.map(normalizeRef)) : null;
  const { rows } = await db.query(
    `SELECT lc.ref, lc.book, lc.tab, lc.sample_id, lc.coffee_key, lc.quality, lc.outturn, lc.grade, lc.detected_at,
            COALESCE(cur.live, false) AS live, cur.receiver, cur.status, cur.date_on,
            row_to_json(l) AS lot
       FROM lot_conflicts lc
       LEFT JOIN lots l ON l.ref = lc.ref
       -- the row today; a soft-deleted one still shows who it went to, so the dry run reads well
       LEFT JOIN LATERAL (
         SELECT s.deleted_at IS NULL AS live, s.receiver_company AS receiver, s.status::text AS status, s.date_on
           FROM specialty_samples s WHERE lc.tab = 'specialty' AND s.id = lc.sample_id
         UNION ALL
         SELECT b.deleted_at IS NULL, b.client, b.status::text, b.date_on
           FROM bulk_samples b WHERE lc.tab = 'bulk' AND b.id = lc.sample_id
       ) cur ON true
      ORDER BY lc.ref, cur.date_on NULLS LAST, lc.detected_at`,
  );
  const groups = new Map<string, ConflictGroup>();
  for (const { lot, ...r } of rows as Array<ConflictRow & { lot: Lot | null }>) {
    const g = groups.get(r.ref) ?? { ref: r.ref, lot, rows: [] };
    g.rows.push(r);
    groups.set(r.ref, g);
  }
  const all = [...groups.values()];
  return only ? all.filter((g) => only.has(g.ref)) : all;
}

/** `minted` = a fresh counter ref was issued for this coffee; false = moved onto a lot that already named it. */
export type Reissued = { tab: Tab; id: string; receiver: string | null; from: string; to: string; coffee: string; minted: boolean };
export type Dropped = { tab: Tab; id: string; ref: string; reason: string };
export type ApplyReport = { reissued: Reissued[]; dropped: Dropped[] };

function coffeeOf(tab: Tab, row: Record<string, unknown>): Coffee {
  return tab === 'specialty'
    ? { book: 'specialty', outturn: row.outturn as string | null, grade: row.grade as string | null, quality: row.description as string | null }
    : { book: 'commercial', quality: row.quality as string | null, blend: row.blend as string | null };
}

/**
 * Re-issue every flagged row that still disagrees with its lot, in ONE transaction. Rows deleted, re-reffed
 * or re-described since detection are dropped (nothing to do). The ref names the coffee, not the send: a
 * row goes onto the lot already naming its coffee (any ref but the group's own), and rows naming the same
 * new coffee share the one new ref across every group of the run.
 */
export async function applyLotConflicts(db: typeof pool = pool, o: { actor?: string; onlyRefs?: string[] } = {}): Promise<ApplyReport> {
  const actor = o.actor ?? LOT_CONFLICTS_ACTOR;
  const report: ApplyReport = { reissued: [], dropped: [] };
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // book|coffee_key → the ref this run settled on for that coffee (found or minted), shared across groups.
    const refByCoffee = new Map<string, { ref: string; minted: boolean }>();
    for (const group of await listLotConflicts(client, { onlyRefs: o.onlyRefs })) {
      const handled: string[] = [];
      for (const c of group.rows) {
        const drop = (reason: string) => { report.dropped.push({ tab: c.tab, id: c.sample_id, ref: c.ref, reason }); handled.push(c.sample_id); };
        if (!c.live) { drop('row deleted since detection'); continue; }
        const table = TABLE[c.tab];
        const refCol = REF_COL[c.tab];
        const { rows: [prev] } = await client.query(`SELECT * FROM ${table} WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [c.sample_id]);
        if (!prev) { drop('row deleted since detection'); continue; }
        if (normalizeRef(prev[refCol] as string) !== group.ref) { drop(`ref changed since detection (now ${prev[refCol]})`); continue; }
        if (!group.lot) { drop('no lot on file for this ref any more'); continue; }
        const coffee = coffeeOf(c.tab, prev);
        const key = coffeeKeyFor(coffee);
        if (key === group.lot.coffee_key) { drop('coffee now matches the lot'); continue; }

        const coffeeId = `${coffee.book}|${key}`;
        let target = refByCoffee.get(coffeeId);
        if (!target) {
          const existing = await findLotByCoffee(client, coffee.book, key);
          if (existing && existing.ref !== group.ref) {
            target = { ref: existing.ref, minted: false };
          } else {
            const to = await issueRef(String(prev.sample_type_norm ?? ''), client);
            await registerLot(client, { ...coffee, ref: to, createdBy: actor });
            target = { ref: to, minted: true };
          }
          refByCoffee.set(coffeeId, target);
        }
        const to = target.ref;
        const from = group.ref;
        const { rows: [row] } = await client.query(`UPDATE ${table} SET ${refCol} = $2, updated_at = now() WHERE id = $1 RETURNING *`, [c.sample_id, to]);
        await client.query(
          `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ($1, $2, 'edited', $3, $4)`,
          [c.tab, c.sample_id, `ref ${from} → ${to}: ${describeCoffee(coffee)} is not the coffee ${from} names (${describeCoffee(group.lot)}) — re-issued by scripts/lot-conflicts.ts`, actor],
        );
        await enqueueRequestEdited(client, c.tab, prev, row, actor, { [refCol]: { from, to } });
        report.reissued.push({ tab: c.tab, id: c.sample_id, receiver: c.receiver, from, to, coffee: describeCoffee(coffee), minted: target.minted });
        handled.push(c.sample_id);
      }
      if (handled.length) await client.query(`DELETE FROM lot_conflicts WHERE ref = $1 AND sample_id = ANY($2::uuid[])`, [group.ref, handled]);
    }
    await client.query('COMMIT');
    client.release();
    return report;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    client.release(e as Error);
    throw e;
  }
}
