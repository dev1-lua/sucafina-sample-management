import type { Request } from 'express';
import { pool } from '../db.js';
import { clampInt } from './validate.js';

export interface ListConfig {
  table: string;                      // trusted identifier from route code (never user input)
  sortable: readonly string[];        // whitelist of columns allowed for ?sort=
  defaultSort: string;                // column used when ?sort= is absent/invalid
  defaultOrder?: 'asc' | 'desc';      // default 'desc'
  searchColumns?: readonly string[];  // columns OR-matched by ?q= (ILIKE)
  includeDeleted?: boolean;           // default false → adds `deleted_at IS NULL`
}

export interface ListResult {
  data: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

export function makeFilters() {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };
  return { where, params, add };
}

export async function buildList(
  cfg: ListConfig,
  query: Request['query'],
  where: string[],
  params: unknown[],
): Promise<ListResult> {
  const w = [...where];
  const p = [...params];
  if (!cfg.includeDeleted) w.push('deleted_at IS NULL');

  const q = String(query.q ?? '').trim();
  if (q && cfg.searchColumns?.length) {
    p.push(q);
    const i = p.length;
    w.push('(' + cfg.searchColumns.map((c) => `${c} ILIKE '%'||$${i}||'%'`).join(' OR ') + ')');
  }

  const sort = cfg.sortable.includes(String(query.sort)) ? String(query.sort) : cfg.defaultSort;
  const orderQ = String(query.order ?? '').toLowerCase();
  const order = orderQ === 'asc' ? 'ASC' : orderQ === 'desc' ? 'DESC' : (cfg.defaultOrder === 'asc' ? 'ASC' : 'DESC');

  const page = clampInt(query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clampInt(query.pageSize, 25, 1, 100);
  const whereSql = w.length ? `WHERE ${w.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT *, count(*) OVER ()::int AS full_count FROM ${cfg.table} ${whereSql}
     ORDER BY ${sort} ${order} NULLS LAST, id ASC
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    p,
  );
  const total = rows[0]?.full_count ?? 0;
  return { data: rows.map(({ full_count, ...row }) => row), total, page, pageSize };
}
