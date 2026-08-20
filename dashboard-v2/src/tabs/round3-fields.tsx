import { CellValue } from '@/components/CellValue';
import { StatusBadge } from '@/components/StatusBadge';
import { formatQty } from '@/lib/format';
import { stockTag } from '@/lib/tags';
import type { ColumnDef, CreateFieldDef, DetailField } from '@/types';

// Feedback round 3 (migration 010), shared by all three books like followup-fields:
// requested_by / completed_by (Muki), stock on hand with a low-stock badge (Anicka),
// and the dispatch date that anchors the automatic client emails.
// Plus migration 011 (feedback #25 — Ivo): the priority / urgency flag.
// Round 5 (migration 013 — Ivo Jr.): requested_by is re-badged "Sales Trader" (whose
// request it is) and logged_by is "Logged By" (who typed it to the bot; agent-stamped).

export const PRIORITIES = ['normal', 'urgent'];

/** Red URGENT pill when the row is flagged; a dash for normal (the default) so the column stays quiet. */
export function PriorityCell({ row }: { row: Record<string, unknown> }) {
  const value = row.priority === 'urgent' ? 'urgent' : null;
  return <StatusBadge kind="priority" value={value} />;
}

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
  { key: 'priority', header: 'Priority', sortKey: 'priority', render: (r) => <PriorityCell row={r} /> },
  { key: 'stock_grams', header: 'Stock', sortKey: 'stock_grams', render: (r) => <StockCell row={r} /> },
  { key: 'requested_by', header: 'Sales Trader', sortKey: 'requested_by', defaultHidden: true },
  { key: 'logged_by', header: 'Logged By', sortKey: 'logged_by', defaultHidden: true },
  { key: 'completed_by', header: 'Completed By', sortKey: 'completed_by', defaultHidden: true },
  { key: 'dispatched_on', header: 'Dispatched', sortKey: 'dispatched_on', defaultHidden: true },
];

export const round3DetailFields: DetailField[] = [
  { key: 'priority', label: 'Priority', edit: { field: 'priority', type: 'select', options: PRIORITIES } },
  { key: 'requested_by', label: 'Sales Trader', edit: { field: 'requested_by', type: 'text' } },
  { key: 'logged_by', label: 'Logged By', edit: { field: 'logged_by', type: 'text' } },
  { key: 'completed_by', label: 'Completed By', edit: { field: 'completed_by', type: 'text' } },
  { key: 'stock_grams', label: 'Stock (g)', edit: { field: 'stock_grams', type: 'number' } },
  { key: 'dispatched_on', label: 'Dispatched On' },
];

export const round3CreateFields: CreateFieldDef[] = [
  { key: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, defaultValue: 'normal' },
  { key: 'requested_by', label: 'Sales Trader', type: 'text' },
  { key: 'logged_by', label: 'Logged By', type: 'text', placeholder: 'who is logging this' },
  { key: 'stock_grams', label: 'Stock (g)', type: 'number', placeholder: 'grams held at the lab' },
];
