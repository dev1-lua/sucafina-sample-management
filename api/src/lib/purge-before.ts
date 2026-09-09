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

const counters = async (q: Q) => (await q.query(`SELECT prefix, next_val FROM ref_counters ORDER BY prefix`)).rows as Counter[];
const wouldHide = (t: Table) => `${t} WHERE deleted_at IS NULL AND ${DATE_EXPR[t]} < $1::date`;

async function preview(q: Q, before: string) {
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
    `SELECT c.id, c.number FROM consignments c
      WHERE c.deleted_at IS NULL AND c.status <> 'closed'
        AND NOT EXISTS (
          SELECT 1 FROM (
            SELECT consignment_id FROM specialty_samples  WHERE deleted_at IS NULL AND NOT (${DATE_EXPR.specialty_samples} < $1::date)
            UNION ALL SELECT consignment_id FROM bulk_samples WHERE deleted_at IS NULL AND NOT (${DATE_EXPR.bulk_samples} < $1::date)
            UNION ALL SELECT consignment_id FROM forwarding_samples WHERE deleted_at IS NULL AND NOT (${DATE_EXPR.forwarding_samples} < $1::date)
          ) m WHERE m.consignment_id = c.id)
        AND EXISTS (SELECT 1 FROM (SELECT consignment_id FROM specialty_samples UNION ALL SELECT consignment_id FROM bulk_samples UNION ALL SELECT consignment_id FROM forwarding_samples) a WHERE a.consignment_id = c.id)
      ORDER BY c.number`, [before]);
  return { tables, outbox_pending_affected: outbox.rows[0].n as number, consignments_to_close: cons.rows as { id: string; number: string }[] };
}

export async function purgeBefore(db: Pool, o: { before: string; apply: boolean; backupAck?: string; iMeanIt?: boolean; actor?: string }): Promise<PurgeReport> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.before)) throw new Error(`--before must be YYYY-MM-DD, got ${o.before}`);
  if (o.before !== DEFAULT_BEFORE && !o.iMeanIt) throw new Error(`refusing --before ${o.before}: the agreed cutoff is ${DEFAULT_BEFORE}; pass --i-mean-it to override`);
  if (o.apply && !o.backupAck) throw new Error(`--apply requires --backup-ack <path of the pg_dump taken first>`);
  const actor = o.actor ?? PURGE_ACTOR;
  const ref_counters_before = await counters(db);
  const pre = await preview(db, o.before);
  const base: PurgeReport = { applied: false, before: o.before, purge_ts: null, ...pre, ref_counters_before, ref_counters_after: null, hidden: null };
  if (!o.apply) return base;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
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
    for (const c of pre.consignments_to_close) {
      await client.query(`UPDATE consignments SET status = 'closed', updated_at = now() WHERE id = $1`, [c.id]);
      await client.query(`INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('consignment', $1, 'edited', $2, $3)`, [c.id, `closed by purge ${purge_ts}: no live samples left`, actor]);
    }
    const ref_counters_after = await counters(client);
    await client.query('COMMIT');
    return { ...base, applied: true, purge_ts, hidden, ref_counters_after };
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
    const re = await client.query(
      `UPDATE consignments c SET status = 'open', updated_at = now()
        WHERE c.status = 'closed' AND EXISTS (SELECT 1 FROM events e WHERE e.entity_type='consignment' AND e.entity_id=c.id AND e.actor=$2 AND e.note = $1)
        RETURNING c.id`, [`closed by purge ${o.purgeTs}: no live samples left`, actor]);
    for (const r of re.rows) await client.query(`INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('consignment', $1, 'edited', $2, $3)`, [r.id, `reopened: purge ${o.purgeTs} restored`, actor]);
    await client.query('COMMIT');
    return { restored, consignments_reopened: re.rowCount ?? 0 };
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
