import { StatusBadge } from '@/components/StatusBadge';
import { CellValue } from '@/components/CellValue';
import type { TabConfig } from './registry';
import { followupColumns, followupDetailFields } from './followup-fields';

// Enums verbatim from the API's forwarding-samples router / global constraints.
// Forwarding's lifecycle omits `results_in` (no result_norm on this table).
const STATUSES = ['requested', 'preparing', 'dispatched', 'delivered', 'cancelled'];
const COURIERS = ['dhl', 'fedex', 'ups', 'rider', 'hand_delivery', 'client_pickup', 'other'];

export const forwardingConfig: TabConfig = {
  endpoint: '/forwarding-samples',
  path: '/forwarding',
  entityLabel: 'Forwarding Sample',
  // Only 11 columns total — no curation needed, all ship visible by default.
  columns: [
    { key: 'date', header: 'Date', sortKey: 'date_on' },
    { key: 'sender', header: 'Sender', sortKey: 'sender' },
    { key: 'origin', header: 'Origin', sortKey: 'origin' },
    { key: 'sample_ref', header: 'Sample Ref', sortKey: 'sample_ref' },
    { key: 'coffee_quality', header: 'Coffee Quality', sortKey: 'coffee_quality' },
    { key: 'receiver_company', header: 'Receiver', sortKey: 'receiver_company' },
    { key: 'id_number', header: 'ID Number', sortKey: 'id_number' },
    { key: 'awb', header: 'AWB', sortKey: 'awb' },
    // Display source is `courier_norm` — the only courier field the API ever writes
    // (the raw `courier` column is legacy-import-only and always empty for app data).
    // Sort by that same normalized column.
    { key: 'courier', header: 'Courier', sortKey: 'courier_norm', render: (r) => <CellValue value={r.courier_norm} humanize /> },
    { key: 'qty', header: 'Qty', sortKey: 'qty_grams' },
    ...followupColumns,
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      render: (r) => <StatusBadge kind="status" value={r.status as string | null} />,
    },
  ],
  filters: [
    { key: 'status', label: 'Status', type: 'enum', options: STATUSES, multi: true },
    { key: 'courier_norm', label: 'Courier', type: 'enum', options: COURIERS, multi: true },
    { key: 'origin', label: 'Origin', type: 'text' },
    { key: 'sender', label: 'Sender', type: 'text' },
    { key: 'date_range', label: 'Date', type: 'date' },
    { key: 'has_awb', label: 'Has AWB', type: 'bool' },
    { key: 'has_id', label: 'Has ID', type: 'bool' },
  ],
  detailFields: [
    { key: 'status', label: 'Status', edit: { field: 'status', type: 'select', options: STATUSES } },
    { key: 'awb', label: 'AWB', edit: { field: 'awb', type: 'text' } },
    { key: 'courier', label: 'Courier', edit: { field: 'courier_norm', type: 'select', options: COURIERS, allowCustom: true } },
    { key: 'id_number', label: 'ID Number', edit: { field: 'id_number', type: 'text' } },
    { key: 'receiver_company', label: 'Receiver', edit: { field: 'receiver_company', type: 'text' } },
    ...followupDetailFields,
  ],
  // Exact field names from forwarding-samples' POST createSchema
  // (api/src/routes/forwarding-samples.ts). Unlike specialty's `ref`, forwarding's
  // `sample_ref` has NO server-side issuance and is a hard-required (min length 1) field
  // — omitting it here (as the generic "server issues the ref" guidance would suggest)
  // would make every forwarding create request fail validation, so it's deliberately
  // included. Omits `qty_grams` (typed sort-only companion of `qty`) and `client_id`
  // (uuid FK — no client picker in this track's scope).
  createFields: [
    { key: 'sender', label: 'Sender', type: 'text', required: true },
    { key: 'origin', label: 'Origin', type: 'text', required: true },
    { key: 'sample_ref', label: 'Sample Ref', type: 'text', required: true },
    { key: 'coffee_quality', label: 'Coffee Quality', type: 'text', required: true },
    { key: 'receiver_company', label: 'Receiver', type: 'text', required: true },
    { key: 'id_number', label: 'ID Number', type: 'text' },
    { key: 'awb', label: 'AWB', type: 'text' },
    { key: 'courier_norm', label: 'Courier', type: 'select', options: COURIERS, allowCustom: true },
    { key: 'qty', label: 'Qty', type: 'text' },
  ],
};
