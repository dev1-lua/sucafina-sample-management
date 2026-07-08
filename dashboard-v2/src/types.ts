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

export type ListQuery = {
  sort: SortState;
  filters: FilterState;
  page: number;
  pageSize: number;
};
