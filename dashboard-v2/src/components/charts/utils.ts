// Shared shaping helpers for the Dashboard's stat -> chart-data transforms.
// Kept framework-agnostic (no React, no recharts) so each chart file only does
// presentation.

export type CountBucket = { key: string; label: string; value: number };

/** Turns a `Record<string, number>` stats group into an ordered bucket list.
 * Keys in `order` come first (in that order, only if present in the record);
 * any keys the record has that aren't in `order` are appended afterward — so an
 * enum that grows on the server doesn't silently drop a bar. */
export function recordToBuckets(record: Record<string, number> | undefined, order: readonly string[] = []): CountBucket[] {
  const rec = record ?? {};
  const seen = new Set<string>();
  const ordered: CountBucket[] = [];

  for (const key of order) {
    if (key in rec) {
      ordered.push({ key, label: key, value: rec[key] ?? 0 });
      seen.add(key);
    }
  }
  for (const [key, value] of Object.entries(rec)) {
    if (!seen.has(key)) ordered.push({ key, label: key, value: value ?? 0 });
  }
  return ordered;
}

/** Sorts a bucket list by value, descending — the default for open-ended,
 * magnitude-comparison groups (courier, country) where reading order should be
 * "biggest first," not enum order. */
export function sortByValueDesc(buckets: CountBucket[]): CountBucket[] {
  return [...buckets].sort((a, b) => b.value - a.value);
}

export function topN(buckets: CountBucket[], n: number): CountBucket[] {
  return sortByValueDesc(buckets).slice(0, n);
}

export function isAllZero(buckets: CountBucket[]): boolean {
  return buckets.length === 0 || buckets.every((b) => !b.value);
}

function titleCase(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));
}

/** `/stats.by_country` carries un-normalized case duplicates from the source data
 * (e.g. "Kenya" / "KENYA" / "kenya" all present as separate keys). This is a
 * presentation-only merge — Title-Case each key and sum counts that collapse to
 * the same label — so the chart shows one "Kenya" bar instead of three. The API
 * payload itself is untouched. */
export function normalizeCountryCounts(byCountry: Record<string, number> | undefined): CountBucket[] {
  const merged = new Map<string, number>();
  for (const [rawKey, count] of Object.entries(byCountry ?? {})) {
    const label = titleCase(rawKey);
    if (!label) continue;
    merged.set(label, (merged.get(label) ?? 0) + (count ?? 0));
  }
  return Array.from(merged, ([label, value]) => ({ key: label, label, value }));
}
