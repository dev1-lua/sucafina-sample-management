import { Link } from 'react-router-dom';

import { CellValue } from '@/components/CellValue';
import { StatusBadge } from '@/components/StatusBadge';
import { formatQty, formatShortDate } from '@/lib/format';
import { sampleStatusTag, stockTag } from '@/lib/tags';
import type { ColumnDef, CreateFieldDef, DetailField, FilterDef } from '@/types';

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
  // Feedback #35 (Brillian): the dispatch date is editable after the fact.
  { key: 'dispatched_on', label: 'Dispatched On', edit: { field: 'dispatched_on', type: 'date' } },
];

// --- Delivery-address gap (migration 016) ---------------------------------------------
// The API flags `client_address_missing` on every sample row whose client has no
// delivery address on file, plus who was asked for it and when
// (`details_requested_from` / `details_requested_at`). Same badge, field and filter on
// all three books so the Quality desk sees the gap wherever they look.

/** "asked Ivo · Sep 3, 2026" for the badge tooltip; null when nobody has been asked yet. */
export function addressAskedSummary(row: Record<string, unknown>): string | null {
  const who = typeof row.details_requested_from === 'string' && row.details_requested_from.trim() !== '' ? row.details_requested_from.trim() : null;
  const when = formatShortDate(row.details_requested_at);
  if (!who && !when) return null;
  return `asked ${who ?? 'someone'}${when ? ` · ${when}` : ''}`;
}

/** Amber "Address needed" pill when the row's client has no delivery address; nothing otherwise. */
export function AddressGapBadge({ row }: { row: Record<string, unknown> }) {
  if (row.client_address_missing !== true) return null;
  return <StatusBadge kind="gap" value="address_needed" title={addressAskedSummary(row) ?? undefined} />;
}

export const addressGapColumn: ColumnDef = {
  key: 'client_address_missing',
  header: 'Address',
  width: 130,
  render: (r) => <AddressGapBadge row={r} />,
};

/** Detail-drawer row: the gap plus a jump to the client page where the address gets added. */
export function AddressGapDetail({ row }: { row: Record<string, unknown> }) {
  if (row.client_address_missing !== true) return <>On file</>;
  const who = typeof row.details_requested_from === 'string' && row.details_requested_from.trim() !== '' ? row.details_requested_from.trim() : null;
  const when = formatShortDate(row.details_requested_at);
  const clientId = typeof row.client_id === 'string' ? row.client_id : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>
        <span aria-hidden="true">⚠ </span>Not on file
        {who ? ` — asked ${who}${when ? ` on ${when}` : ''}` : ' — nobody asked yet'}
      </span>
      {clientId && (
        <Link to={`/clients/${clientId}`} className="font-medium text-primary hover:underline">
          Add address
        </Link>
      )}
    </span>
  );
}

export const addressGapDetailField: DetailField = {
  key: 'client_address_missing',
  label: 'Delivery address',
  render: (r) => <AddressGapDetail row={r} />,
  // A sample with no linked client has no address to be missing — skip the row entirely.
  // Also skipped when the API didn't send the flag at all (older build), so "On file" is
  // only ever shown when the server explicitly said so.
  hidden: (r) => typeof r.client_id !== 'string' || r.client_id === '' || typeof r.client_address_missing !== 'boolean',
};

export const addressGapFilter: FilterDef = { key: 'address_missing', label: 'Address needed', type: 'bool' };

// --- Awaiting collection (lifecycle sketch 2026-09-14) ---------------------------------
// "When the AWB is added it means the coffee is awaiting collection by DHL." The API derives
// `awaiting_collection` (AWB on file, status still requested/preparing) on every read; the
// status pill shows it in place of the stored status, the drawer explains it, and a filter
// lists what is booked but not yet picked up. Same on all three books.

/** Status pill: the derived "awaiting collection" while the AWB waits for pickup, else the stored status. */
export function SampleStatusCell({ row }: { row: Record<string, unknown> }) {
  const value = sampleStatusTag(row);
  const title =
    value === 'awaiting_collection'
      ? `AWB ${typeof row.awb === 'string' ? row.awb : '?'} — booked, not yet collected by ${courierName(row.courier_norm)}`
      : undefined;
  return <StatusBadge kind="status" value={value} title={title} />;
}

const COURIER_NAMES: Record<string, string> = {
  dhl: 'DHL', fedex: 'FedEx', ups: 'UPS', rider: 'the rider', hand_delivery: 'hand delivery',
  client_pickup: 'the client', wells_fargo: 'Wells Fargo',
};
function courierName(courier: unknown): string {
  return typeof courier === 'string' && COURIER_NAMES[courier] ? COURIER_NAMES[courier] : 'the courier';
}

export const awaitingCollectionFilter: FilterDef = { key: 'awaiting_collection', label: 'Awaiting collection', type: 'bool' };

/** Detail-drawer row shown only while the parcel is booked but not collected; the Status select stays editable. */
export const awaitingCollectionDetailField: DetailField = {
  key: 'awaiting_collection',
  label: 'Collection',
  render: (r) => (
    <span>
      <span aria-hidden="true">⏳ </span>
      Awaiting {courierName(r.courier_norm)} collection — AWB {typeof r.awb === 'string' ? r.awb : '?'}. Set Status to “dispatched” once picked up.
    </span>
  ),
  hidden: (r) => r.awaiting_collection !== true,
};

export const round3CreateFields: CreateFieldDef[] = [
  { key: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, defaultValue: 'normal' },
  { key: 'requested_by', label: 'Sales Trader', type: 'text' },
  { key: 'logged_by', label: 'Logged By', type: 'text', placeholder: 'who is logging this' },
  { key: 'stock_grams', label: 'Stock (g)', type: 'number', placeholder: 'grams held at the lab' },
];
