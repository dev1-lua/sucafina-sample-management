import type { pool as PoolT } from '../db.js';
type Pool = Pick<typeof PoolT, 'query' | 'connect'>;
type Q = Pick<typeof PoolT, 'query'>;

export const PURGE_ACTOR = 'script:purge-before';
export const DEFAULT_BEFORE = '2026-08-01';
export const TABLES = ['specialty_samples', 'bulk_samples', 'forwarding_samples', 'samples'] as const;
export type Table = (typeof TABLES)[number];
/** The "sample date" per table: the books have date_on; legacy `samples` (001) only requested_at. */
const DATE_EXPR: Record<Table, string> = {
  specialty_samples: 'COALESCE(date_on, created_at::date)',
  bulk_samples: 'COALESCE(date_on, created_at::date)',
  forwarding_samples: 'COALESCE(date_on, created_at::date)',
  samples: 'COALESCE(requested_at::date, created_at::date)',
};
const OUTBOX_TAB: Partial<Record<Table, string>> = { specialty_samples: 'specialty', bulk_samples: 'bulk', forwarding_samples: 'forwarding' };
const ENTITY: Partial<Record<Table, string>> = { specialty_samples: 'specialty', bulk_samples: 'bulk', forwarding_samples: 'forwarding' };

export type TableCount = { table: Table; before_cutoff: number; live: number; would_hide: number };
export type Counter = { prefix: string; next_val: number };
export type PurgeReport = {
  applied: boolean; before: string; purge_ts: string | null; tables: TableCount[];
  outbox_pending_affected: number; consignments_to_close: { id: string; number: string }[];
  ref_counters_before: Counter[]; ref_counters_after: Counter[] | null; hidden: Record<Table, number> | null;
};

/** Internal only — `status` rides along so an apply-time close can record it and a restore can put it
 *  back verbatim; the public report field stays `{ id, number }` (see `stripStatus`). */
type ConsignmentClose = { id: string; number: string; status: string };
const stripStatus = (rows: ConsignmentClose[]) => rows.map(({ id, number }) => ({ id, number }));

const counters = async (q: Q) => (await q.query(`SELECT prefix, next_val FROM ref_counters ORDER BY prefix`)).rows as Counter[];
const wouldHide = (t: Table) => `${t} WHERE deleted_at IS NULL AND ${DATE_EXPR[t]} < $1::date`;

async function preview(q: Q, before: string): Promise<{ tables: TableCount[]; outbox_pending_affected: number; consignments_to_close: ConsignmentClose[] }> {
  const tables: TableCount[] = [];
  for (const t of TABLES) {
    const { rows } = await q.query(
      `SELECT (SELECT count(*) FROM ${t} WHERE ${DATE_EXPR[t]} < $1::date)::int AS before_cutoff,
              (SELECT count(*) FROM ${t} WHERE deleted_at IS NULL)::int AS live,
              (SELECT count(*) FROM ${wouldHide(t)})::int AS would_hide`, [before]);
    tables.push({ table: t, ...rows[0] });
  }
  const outbox = await q.query(
    `SELECT count(*)::int AS n FROM notifications_outbox o WHERE o.sent_at IS NULL AND (
       (o.tab='specialty' AND o.sample_id IN (SELECT id FROM ${wouldHide('specialty_samples')})) OR
       (o.tab='bulk'      AND o.sample_id IN (SELECT id FROM ${wouldHide('bulk_samples')})) OR
       (o.tab='forwarding'AND o.sample_id IN (SELECT id FROM ${wouldHide('forwarding_samples')})))`, [before]);
  // consignments that would have zero live members once the old rows are hidden
  const cons = await q.query(
    `SELECT c.id, c.number, c.status FROM consignments c
      WHERE c.deleted_at IS NULL AND c.status <> 'closed'
        AND NOT EXISTS (
          SELECT 1 FROM (
            SELECT consignment_id FROM specialty_samples  WHERE deleted_at IS NULL AND NOT (${DATE_EXPR.specialty_samples} < $1::date)
            UNION ALL SELECT consignment_id FROM bulk_samples WHERE deleted_at IS NULL AND NOT (${DATE_EXPR.bulk_samples} < $1::date)
            UNION ALL SELECT consignment_id FROM forwarding_samples WHERE deleted_at IS NULL AND NOT (${DATE_EXPR.forwarding_samples} < $1::date)
          ) m WHERE m.consignment_id = c.id)
        AND EXISTS (SELECT 1 FROM (SELECT consignment_id FROM specialty_samples UNION ALL SELECT consignment_id FROM bulk_samples UNION ALL SELECT consignment_id FROM forwarding_samples) a WHERE a.consignment_id = c.id)
      ORDER BY c.number`, [before]);
  return { tables, outbox_pending_affected: outbox.rows[0].n as number, consignments_to_close: cons.rows as ConsignmentClose[] };
}

export async function purgeBefore(db: Pool, o: { before: string; apply: boolean; backupAck?: string; iMeanIt?: boolean; actor?: string }): Promise<PurgeReport> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.before)) throw new Error(`--before must be YYYY-MM-DD, got ${o.before}`);
  if (o.before !== DEFAULT_BEFORE && !o.iMeanIt) throw new Error(`refusing --before ${o.before}: the agreed cutoff is ${DEFAULT_BEFORE}; pass --i-mean-it to override`);
  if (o.apply && !o.backupAck) throw new Error(`--apply requires --backup-ack <path of the pg_dump taken first>`);
  const actor = o.actor ?? PURGE_ACTOR;
  const ref_counters_before = await counters(db);
  const pre = await preview(db, o.before);
  const base: PurgeReport = {
    applied: false, before: o.before, purge_ts: null,
    tables: pre.tables, outbox_pending_affected: pre.outbox_pending_affected,
    consignments_to_close: stripStatus(pre.consignments_to_close),
    ref_counters_before, ref_counters_after: null, hidden: null,
  };
  if (!o.apply) return base;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Review round 1, #2: `pre` above was computed on `db` before BEGIN — a write landing in that gap
    // (a sample attached to a consignment, another sample hidden/restored) would make the close set and
    // the printed counts describe a moment this transaction never actually saw. Recompute on `client`,
    // inside the transaction, and drive the hide/close work and the returned report from THIS snapshot.
    const txPre = await preview(client, o.before);
    const purge_ts = (await client.query(`SELECT now()::text AS ts`)).rows[0].ts as string;
    const note = `purged: dated before ${o.before} (backup: ${o.backupAck})`;
    const hidden = {} as Record<Table, number>;
    for (const t of TABLES) {
      const ids = (await client.query(`SELECT id FROM ${wouldHide(t)}`, [o.before])).rows.map((r) => r.id as string);
      hidden[t] = ids.length;
      if (!ids.length) continue;
      await client.query(`UPDATE ${t} SET deleted_at = $1::timestamptz, updated_at = $1::timestamptz WHERE id = ANY($2::uuid[])`, [purge_ts, ids]);
      if (t === 'samples') {
        await client.query(`INSERT INTO sample_events (sample_id, type, note, actor) SELECT unnest($1::uuid[]), 'deleted', $2, $3`, [ids, note, actor]);
      } else {
        await client.query(`INSERT INTO events (entity_type, entity_id, type, note, actor) SELECT $1::entity_type_scope, unnest($2::uuid[]), 'deleted', $3, $4`, [ENTITY[t], ids, note, actor]);
        await client.query(`UPDATE notifications_outbox SET sent_at = now(), attempts = attempts + 1, last_error = $3 WHERE sent_at IS NULL AND tab = $1 AND sample_id = ANY($2::uuid[])`, [OUTBOX_TAB[t], ids, `purged: ${purge_ts}`]);
      }
    }
    for (const c of txPre.consignments_to_close) {
      await client.query(`UPDATE consignments SET status = 'closed', updated_at = now() WHERE id = $1`, [c.id]);
      // Review round 1, #1: record the PRIOR status in the note so --restore can put it back verbatim —
      // a 'dispatched' consignment closed by the purge must come back 'dispatched', not a hardcoded 'open'.
      await client.query(
        `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('consignment', $1, 'edited', $2, $3)`,
        [c.id, `closed by purge ${purge_ts} (was ${c.status}): no live samples left`, actor],
      );
    }
    const ref_counters_after = await counters(client);
    await client.query('COMMIT');
    return {
      ...base, applied: true, purge_ts, hidden, ref_counters_after,
      tables: txPre.tables, outbox_pending_affected: txPre.outbox_pending_affected,
      consignments_to_close: stripStatus(txPre.consignments_to_close),
    };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

export async function restorePurge(db: Pool, o: { purgeTs: string; actor?: string }) {
  const actor = o.actor ?? PURGE_ACTOR;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const restored = {} as Record<Table, number>;
    for (const t of TABLES) {
      const ids = (await client.query(`SELECT id FROM ${t} WHERE deleted_at = $1::timestamptz`, [o.purgeTs])).rows.map((r) => r.id as string);
      restored[t] = ids.length;
      if (!ids.length) continue;
      await client.query(`UPDATE ${t} SET deleted_at = NULL, updated_at = now() WHERE id = ANY($1::uuid[])`, [ids]);
      if (t === 'samples') await client.query(`INSERT INTO sample_events (sample_id, type, note, actor) SELECT unnest($1::uuid[]), 'restored', $2, $3`, [ids, `restored purge ${o.purgeTs}`, actor]);
      else await client.query(`INSERT INTO events (entity_type, entity_id, type, note, actor) SELECT $1::entity_type_scope, unnest($2::uuid[]), 'restored', $3, $4`, [ENTITY[t], ids, `restored purge ${o.purgeTs}`, actor]);
    }
    // Review round 1, #1: put each consignment back to the status recorded in its close-event note
    // (`closed by purge <ts> (was <status>): …`) instead of forcing 'open'.
    const closedByThisPurge = await client.query(
      `SELECT c.id, e.note FROM consignments c
         JOIN events e ON e.entity_type = 'consignment' AND e.entity_id = c.id AND e.actor = $2
        WHERE c.status = 'closed' AND e.note LIKE $1
        ORDER BY c.number`,
      [`closed by purge ${o.purgeTs} (was %`, actor],
    );
    let consignments_reopened = 0;
    for (const row of closedByThisPurge.rows as { id: string; note: string }[]) {
      const priorStatus = /\(was ([^)]*)\)/.exec(row.note)?.[1] ?? 'open';
      await client.query(`UPDATE consignments SET status = $1, updated_at = now() WHERE id = $2`, [priorStatus, row.id]);
      await client.query(
        `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('consignment', $1, 'edited', $2, $3)`,
        [row.id, `reopened: purge ${o.purgeTs} restored (status → ${priorStatus})`, actor],
      );
      consignments_reopened += 1;
    }
    await client.query('COMMIT');
    return { restored, consignments_reopened };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

/**
 * Review round 1, #3 (promoted to Important — this drives a destructive prod tool and `--backup-ack` is
 * the human's safety gate): a bare `argv[i+1]` lookup silently mis-parses `--before` with nothing after
 * it (falls back to the default), `--restore` with nothing after it (silently becomes a dry-run preview),
 * and `--apply --backup-ack --i-mean-it` (treats the next flag as the backup path). Reject both: a flag
 * present with no following token, or whose "value" is itself another flag, is a usage error.
 */
export function requiredFlagValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`${flag} requires a value`);
  return v;
}

/** Review round 1, #3 (cheap guard): a restore that brought samples back but reopened no consignment is
 *  usually fine (most hidden samples aren't the last live member of one) but worth a human glance. */
export function restoreNeedsAttention(restored: Record<Table, number>, consignmentsReopened: number): boolean {
  const totalRestored = Object.values(restored).reduce((a, b) => a + b, 0);
  return totalRestored > 0 && consignmentsReopened === 0;
}
