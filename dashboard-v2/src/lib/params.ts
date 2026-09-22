import type { FilterState, ListQuery, ListView } from '@/types';

export function buildListParams(q: ListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.sort) { p.set('sort', q.sort.sort); p.set('order', q.sort.order); }
  p.set('page', String(q.page));
  p.set('pageSize', String(q.pageSize));
  for (const [k, v] of Object.entries(q.filters)) {
    if (v == null) continue;
    if (Array.isArray(v)) { if (v.length) p.set(k, v.join(',')); }
    else if (v !== '') p.set(k, v);
  }
  return p;
}

// --- List URL ⇄ state (round 10) ---------------------------------------------------------
// Only the keys the agent deep-links on are mirrored in the URL: `ref` and `consignment` (both
// FilterState keys the book lists accept) plus the Sends · Coffees · Orders `view`. Everything
// else in FilterState stays local; every other URL param (e.g. `hl`) is left untouched.
export const LIST_VIEWS: readonly ListView[] = ['sends', 'coffees', 'orders'];
const URL_FILTER_KEYS = ['ref', 'consignment'] as const;

export function asListView(value: unknown): ListView | null {
  return typeof value === 'string' && (LIST_VIEWS as readonly string[]).includes(value) ? (value as ListView) : null;
}

/** `?ref=&consignment=&view=` → the filters to seed FilterState with and the requested view (null = none). */
export function readListUrl(sp: URLSearchParams): { filters: FilterState; view: ListView | null } {
  const filters: FilterState = {};
  for (const key of URL_FILTER_KEYS) {
    const v = sp.get(key);
    if (v) filters[key] = v;
  }
  return { filters, view: asListView(sp.get('view')) };
}

/** A copy of `sp` with the mirrored keys written from state (or removed when cleared / default). */
export function writeListUrl(sp: URLSearchParams, filters: FilterState, view: ListView): URLSearchParams {
  const next = new URLSearchParams(sp);
  for (const key of URL_FILTER_KEYS) {
    const v = filters[key];
    if (typeof v === 'string' && v !== '') next.set(key, v);
    else next.delete(key);
  }
  if (view === 'sends') next.delete('view');
  else next.set('view', view);
  return next;
}
