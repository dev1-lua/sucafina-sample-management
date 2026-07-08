import type { ListQuery } from '@/types';

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
