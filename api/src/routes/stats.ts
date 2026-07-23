import { Router } from 'express';
import type { Request } from 'express';
import { pool } from '../db.js';
import { h } from '../errors.js';
import { makeFilters } from '../lib/list.js';

export const stats = Router();

const groupToMap = (rows: { k: string | null; n: number }[]): Record<string, number> => {
  const m: Record<string, number> = {};
  for (const r of rows) if (r.k != null) m[r.k] = r.n;
  return m;
};

// Dashboard filters. Column names come from this fixed whitelist (never user input),
// so interpolating them is injection-safe; values are always bound as $n params.
// Enum columns are compared as ::text = ANY(?::text[]) so an unknown value simply
// fails to match instead of raising an "invalid input value for enum" 500. `month` is
// matched the same way over the derived YYYY-MM token. `country` is handled separately
// below (case-insensitive) since it is open free text.
const CSV_FILTERS: Record<string, string> = {
  tab: 'tab',
  status: 'status::text',
  sample_type: 'sample_type_norm::text',
  courier: 'courier_norm::text',
  result: 'result_norm::text',
  month: `to_char(date_trunc('month', date_on), 'YYYY-MM')`,
};

// Read a filter param that may arrive as a single CSV string (the agent's `status=a,b`) or as
// repeated params that Express parses into an array (the dashboard — comma-safe). Controlled-vocab
// values are safe to comma-split.
function toList(raw: unknown): string[] {
  if (raw == null) return [];
  const parts = Array.isArray(raw) ? (raw as unknown[]).map((x) => String(x)) : String(raw).split(',');
  return parts.map((s) => s.trim()).filter(Boolean);
}
// Like toList but NEVER comma-splits a string — for free-text values (quality) that contain commas.
// A single string is one value; the dashboard sends several via repeated params (an array).
function toValues(raw: unknown): string[] {
  if (raw == null) return [];
  const parts = Array.isArray(raw) ? (raw as unknown[]).map((x) => String(x)) : [String(raw)];
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** Build the parameterized filter fragment shared by every view-based aggregate.
 * Returns a clause that begins with ' AND …' (or '' when no filters are set) plus
 * the positional params. All aggregate queries reference the same $1..$n, so they
 * are handed the same `params` array. */
function buildStatsFilter(query: Request['query']): { clause: string; params: unknown[] } {
  const f = makeFilters();

  for (const [param, col] of Object.entries(CSV_FILTERS)) {
    const values = toList(query[param]);
    if (values.length) f.add(`${col} = ANY (?::text[])`, values);
  }

  // Country: case-insensitive (BELGIUM/Belgium/belgium all match), multi-select, comma-safe (values
  // like "Hong Kong Sar,China" arrive as one repeated param). The facet list + by_country aggregate
  // canonicalize to Title Case (initcap) for display.
  const countries = toList(query.country).map((s) => s.toLowerCase());
  if (countries.length) f.add(`lower(country) = ANY (?::text[])`, countries);

  // Quality: exact multi-select over the free-text `title` — the dashboard picks whole values from a
  // list, so exact avoids over-matching (picking "AA" must not pull in "AA FAQ"). NOT comma-split;
  // quality strings contain commas and the dashboard sends them as repeated params.
  const qualities = toValues(query.quality);
  if (qualities.length) f.add(`title = ANY (?::text[])`, qualities);

  // `quality_like` is the agent's substring match (get_sample_stats) — kept separate from the
  // dashboard's exact multi-select above so both semantics coexist on /stats.
  const qualityLike = String(query.quality_like ?? '').trim();
  if (qualityLike) f.add(`title ILIKE '%'||?||'%'`, qualityLike);

  return { clause: f.where.length ? ` AND ${f.where.join(' AND ')}` : '', params: f.params };
}

stats.get('/', h(async (req, res) => {
  const { clause, params } = buildStatsFilter(req.query);
  const base = `FROM all_samples_v WHERE deleted_at IS NULL${clause}`;
  // Full-domain option lists for the dashboard filter dropdowns — deliberately
  // computed WITHOUT `clause` so the Month/Country/Quality choices never collapse to
  // just whatever the current filter leaves behind.
  const optBase = `FROM all_samples_v WHERE deleted_at IS NULL`;

  const [byStatus, byTab, bySampleType, byResult, byCourier, byCountry, volume, scalars, dispatchedThisWeek, approvalByType, feedbackTiming, months, countries, qualities] =
    await Promise.all([
      pool.query(`SELECT status AS k, count(*)::int AS n ${base} GROUP BY status`, params),
      pool.query(`SELECT tab AS k, count(*)::int AS n ${base} GROUP BY tab`, params),
      // sample_type_norm is now projected by all_samples_v (migration 003), so this
      // aggregate runs off the same filtered `base` as everything else.
      pool.query(`SELECT sample_type_norm::text AS k, count(*)::int AS n ${base} AND sample_type_norm IS NOT NULL GROUP BY sample_type_norm`, params),
      pool.query(`SELECT result_norm::text AS k, count(*)::int AS n ${base} AND result_norm IS NOT NULL GROUP BY result_norm`, params),
      pool.query(`SELECT courier_norm::text AS k, count(*)::int AS n ${base} AND courier_norm IS NOT NULL GROUP BY courier_norm`, params),
      pool.query(`SELECT initcap(country) AS k, count(*)::int AS n ${base} AND country IS NOT NULL GROUP BY initcap(country) ORDER BY n DESC LIMIT 15`, params),
      pool.query(`SELECT to_char(date_trunc('month', date_on), 'YYYY-MM') AS month, count(*)::int AS n
                  ${base} AND date_on IS NOT NULL GROUP BY 1 ORDER BY 1`, params),
      pool.query(`
        SELECT
          (SELECT count(*)::int ${base} AND status = 'dispatched') AS in_transit,
          (SELECT count(*)::int ${base} AND status = 'delivered' AND result_norm IS NULL AND tab <> 'forwarding') AS awaiting_results,
          (SELECT count(*)::int ${base} AND status = 'delivered' AND result_norm IS NULL AND tab <> 'forwarding'
                AND coalesce(delivery_on, date_on) < CURRENT_DATE - interval '7 days') AS awaiting_results_aging
      `, params),
      // Events-based "this week" activity metric — intentionally global (not scoped
      // by the sample-dimension filters, which don't map onto the event log).
      pool.query(`SELECT count(*)::int AS n FROM events
                  WHERE type = 'dispatched' AND created_at >= date_trunc('week', now())`),
      // Feedback ⑮: approval outcomes per sample type (Offer / Type / PSS / …). Only rows that
      // reached a verdict count toward the rate, so `total` = approved + rejected (pending_feedback
      // is excluded); `rate` is the approved share of decided samples. Forwarding never carries a
      // result, so it naturally contributes nothing here.
      pool.query(`
        SELECT sample_type_norm::text AS k,
               count(*) FILTER (WHERE result_norm = 'approved')::int AS approved,
               count(*) FILTER (WHERE result_norm = 'rejected')::int AS rejected
          ${base} AND sample_type_norm IS NOT NULL AND result_norm IN ('approved','rejected')
         GROUP BY sample_type_norm`, params),
      // Feedback ⑭: average delivered→result turnaround, in days. Only rows where both dates were
      // captured count (result_on lands from migration 009 onward), so historical rows without a
      // recorded verdict date don't skew it. `n` is how many rows the average is based on.
      pool.query(`
        SELECT avg(result_on - delivery_on)::numeric(10,1) AS avg_days,
               count(*)::int AS n
          ${base} AND result_on IS NOT NULL AND delivery_on IS NOT NULL AND result_on >= delivery_on`, params),
      pool.query(`SELECT to_char(date_trunc('month', date_on), 'YYYY-MM') AS m ${optBase} AND date_on IS NOT NULL GROUP BY 1 ORDER BY 1 DESC`),
      pool.query(`SELECT initcap(country) AS c ${optBase} AND country IS NOT NULL GROUP BY 1 ORDER BY 1`),
      // Quality (unified `title`) is free text — return every distinct value, verbatim, for the
      // searchable Quality dropdown. Matching stays ILIKE (see buildStatsFilter), so a picked value
      // filters to its row(s) and the agent's substring quality filter is unaffected.
      pool.query(`SELECT DISTINCT title AS q ${optBase} AND title IS NOT NULL AND title <> '' ORDER BY 1`),
    ]);
  // Shape the per-type approval rows into { type: {approved, rejected, total, rate} } and roll
  // them up into an overall rate. `rate` is null when nothing was decided (avoids 0/0 → NaN).
  const approvalMap: Record<string, { approved: number; rejected: number; total: number; rate: number | null }> = {};
  let totApproved = 0, totDecided = 0;
  for (const row of approvalByType.rows as { k: string; approved: number; rejected: number }[]) {
    const total = row.approved + row.rejected;
    approvalMap[row.k] = { approved: row.approved, rejected: row.rejected, total, rate: total ? row.approved / total : null };
    totApproved += row.approved; totDecided += total;
  }

  res.json({
    by_status: groupToMap(byStatus.rows),
    by_tab: groupToMap(byTab.rows),
    by_sample_type: groupToMap(bySampleType.rows),
    by_result: groupToMap(byResult.rows),
    by_courier: groupToMap(byCourier.rows),
    by_country: groupToMap(byCountry.rows),
    volume_over_time: volume.rows,
    ...scalars.rows[0],
    dispatched_this_week: dispatchedThisWeek.rows[0].n,
    approval_by_type: approvalMap,
    approval_rate: totDecided ? totApproved / totDecided : null,
    // Average feedback turnaround (days) + the sample count it's based on (null when none captured).
    avg_feedback_days: feedbackTiming.rows[0].avg_days == null ? null : Number(feedbackTiming.rows[0].avg_days),
    feedback_sample_count: feedbackTiming.rows[0].n,
    months: months.rows.map((r) => r.m),
    countries: countries.rows.map((r) => r.c),
    qualities: qualities.rows.map((r) => r.q),
  });
}));
