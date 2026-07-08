import type * as React from 'react';

export type ListResult<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type EventRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  type: string;
  note: string | null;
  actor: string;
  created_at: string;
};

export type TabKey = 'specialty' | 'bulk' | 'forwarding' | 'clients';

export type SortState = { sort: string; order: 'asc' | 'desc' } | null;

export type FilterState = Record<string, string | string[]>;

export type FilterDef =
  | { key: string; label: string; type: 'enum'; options: string[]; multi?: boolean }
  | { key: string; label: string; type: 'text' }
  | { key: string; label: string; type: 'bool'; trueValue?: string } // e.g. has_awb=true
  | { key: string; label: string; type: 'date' } // maps to date_from/date_to pair handled by caller
  | { key: string; label: string; type: 'numrange'; minKey: string; maxKey: string };

export type ListQuery = {
  sort: SortState;
  filters: FilterState;
  page: number;
  pageSize: number;
};

export type ColumnDef = {
  key: string; // row field to display (source column)
  header: string; // column header label
  sortKey?: string; // API sort value; omit => not sortable
  width?: number; // px
  render?: (row: Record<string, unknown>) => React.ReactNode; // custom cell (e.g. StatusBadge)
  edit?: { field: string; type: 'text' | 'select'; options?: string[] }; // inline edit → PATCH {field: value}
};
