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

// --- Chaser digest ------------------------------------------------------------
// Shape mirrors the API's computeDigest (api/src/lib/digest.ts): each bucket item
// selects `tab, id, ref, title AS quality, receiver, awb, date_on, delivery_on`.
export type DigestItem = {
  tab: string; // 'specialty' | 'bulk' | 'forwarding' — which sample table the row lives in
  id: string | number;
  ref?: string | null;
  quality?: string | null;
  receiver?: string | null;
  awb?: string | null;
  date_on?: string | null; // scheduled/dispatch date
  delivery_on?: string | null;
};
export type DigestBucketKey = 'not_dispatched' | 'no_delivery_confirmation' | 'awaiting_results';
export type DigestBucket = { count: number; items: DigestItem[] };
export type Digest = {
  generated_at: string;
  buckets: Record<DigestBucketKey, DigestBucket>;
};

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
  defaultHidden?: boolean; // hidden by default in the Columns show/hide menu (still user-toggleable, still persisted)
};

// Sibling to ColumnDef (RecordTable) / FilterDef (FilterBar): describes one row in
// DetailDrawer's Details tab. Same render/edit shape as ColumnDef by design, but scoped
// to a single detail record rather than a table row.
export type DetailField = {
  key: string; // detail-row field to display
  label: string; // field label
  render?: (row: Record<string, unknown>) => React.ReactNode; // custom read-only rendering (e.g. StatusBadge)
  // inline edit → PATCH {field: value}. `allowCustom` turns a select into an
  // editable one (EditableSelect): picking "Other…" lets the user type a value
  // outside `options` (requires the backing column to be free text).
  edit?: { field: string; type: 'text' | 'select'; options?: string[]; allowCustom?: boolean };
};

// Drives CreateRecordDialog's form. `key` must be the EXACT field name accepted by the
// table's POST body zod schema (see api/src/routes/{specialty,bulk,forwarding}-samples.ts)
// — not necessarily the same as a ColumnDef.key, since some columns display a normalized
// companion field (e.g. `courier_norm`) that IS the POST field, while others display a
// column that has no create-time equivalent at all.
export type CreateFieldDef = {
  key: string; // POST body field name
  label: string;
  type: 'text' | 'select' | 'number' | 'date';
  options?: string[]; // for type: 'select'
  allowCustom?: boolean; // select only: picking "Other…" lets the user type a custom value
  required?: boolean;
  defaultValue?: string | number;
  placeholder?: string;
};
