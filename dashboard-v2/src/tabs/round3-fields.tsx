import { CellValue } from '@/components/CellValue';
import { StatusBadge } from '@/components/StatusBadge';
import { formatQty } from '@/lib/format';
import { stockTag } from '@/lib/tags';
import type { ColumnDef, CreateFieldDef, DetailField } from '@/types';

// Feedback round 3 (migration 010), shared by all three books like followup-fields:
// requested_by / completed_by (Muki), stock on hand with a low-stock badge (Anicka),
// and the dispatch date that anchors the automatic client emails.

/** Grams on hand plus a Low/Out badge when the lab holds less than this row sends. */
export function StockCell({ row }: { row: Record<string, unknown> }) {
  const tag = stockTag(row.stock_grams, row.qty_grams);
  const qty = formatQty(row.stock_grams);
  if (qty === null) return <CellValue value={null} />;
  return (
    <span className="inline-flex items-center gap-1.5">
      {qty}
      {tag && <StatusBadge kind="stock" value={tag} />}
    </span>
  );
}

export const round3Columns: ColumnDef[] = [
  { key: 'stock_grams', header: 'Stock', sortKey: 'stock_grams', render: (r) => <StockCell row={r} /> },
  { key: 'requested_by', header: 'Requested By', sortKey: 'requested_by', defaultHidden: true },
  { key: 'completed_by', header: 'Completed By', sortKey: 'completed_by', defaultHidden: true },
  { key: 'dispatched_on', header: 'Dispatched', sortKey: 'dispatched_on', defaultHidden: true },
];

export const round3DetailFields: DetailField[] = [
  { key: 'requested_by', label: 'Requested By', edit: { field: 'requested_by', type: 'text' } },
  { key: 'completed_by', label: 'Completed By', edit: { field: 'completed_by', type: 'text' } },
  { key: 'stock_grams', label: 'Stock (g)', edit: { field: 'stock_grams', type: 'number' } },
  { key: 'dispatched_on', label: 'Dispatched On' },
];

export const round3CreateFields: CreateFieldDef[] = [
  { key: 'requested_by', label: 'Requested By', type: 'text' },
  { key: 'stock_grams', label: 'Stock (g)', type: 'number', placeholder: 'grams held at the lab' },
];
