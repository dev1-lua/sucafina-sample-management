import { StatusBadge } from '@/components/StatusBadge';
import { CellValue } from '@/components/CellValue';
import type { TabConfig } from './registry';

// Enums verbatim from the API's specialty-samples router / global constraints.
const STATUSES = ['requested', 'preparing', 'dispatched', 'delivered', 'results_in', 'cancelled'];
const COURIERS = ['dhl', 'fedex', 'ups', 'rider', 'hand_delivery', 'client_pickup', 'other'];
const RESULTS = ['approved', 'rejected', 'pending_feedback'];
const SAMPLE_TYPES = [
  'offer',
  'type',
  'pss',
  'woc',
  'retention',
  'flavor_mapping',
  'marketing',
  'calibration',
  'other',
];

export const specialtyConfig: TabConfig = {
  endpoint: '/specialty-samples',
  path: '/samples',
  entityLabel: 'Specialty Sample',
  columns: [
    { key: 'date', header: 'Date', sortKey: 'date_on' },
    { key: 'ref', header: 'Ref', sortKey: 'ref' },
    { key: 'outturn', header: 'Outturn', defaultHidden: true },
    { key: 'name', header: 'Name' },
    { key: 'grade', header: 'Grade' },
    { key: 'bags', header: 'Bags', defaultHidden: true },
    { key: 'description', header: 'Description', sortKey: 'description', defaultHidden: true },
    { key: 'receiver_company', header: 'Receiver', sortKey: 'receiver_company' },
    { key: 'awb', header: 'AWB' },
    // Display source is `courier_norm` — the only courier field the API ever writes
    // (the raw `courier` column is legacy-import-only and always empty for app data).
    { key: 'courier', header: 'Courier', render: (r) => <CellValue value={r.courier_norm} humanize /> },
    { key: 'qty', header: 'Qty', sortKey: 'qty_grams', defaultHidden: true },
    { key: 'delivery_date', header: 'Delivery Date', sortKey: 'delivery_on' },
    {
      key: 'result',
      header: 'Result',
      render: (r) => <StatusBadge kind="result" value={r.result_norm as string | null} />,
    },
    { key: 'comments', header: 'Comments', defaultHidden: true },
    { key: 'crop_year', header: 'Crop Year', defaultHidden: true },
    { key: 'crop_area_details', header: 'Crop Area Details', defaultHidden: true },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      render: (r) => <StatusBadge kind="status" value={r.status as string | null} />,
    },
  ],
  filters: [
    { key: 'status', label: 'Status', type: 'enum', options: STATUSES, multi: true },
    { key: 'sample_type_norm', label: 'Sample Type', type: 'enum', options: SAMPLE_TYPES },
    { key: 'courier_norm', label: 'Courier', type: 'enum', options: COURIERS },
    { key: 'result_norm', label: 'Result', type: 'enum', options: RESULTS },
    { key: 'date_range', label: 'Date', type: 'date' },
    { key: 'has_awb', label: 'Has AWB', type: 'bool' },
  ],
  detailFields: [
    { key: 'status', label: 'Status', edit: { field: 'status', type: 'select', options: STATUSES } },
    { key: 'awb', label: 'AWB', edit: { field: 'awb', type: 'text' } },
    { key: 'courier', label: 'Courier', edit: { field: 'courier_norm', type: 'select', options: COURIERS } },
    { key: 'result', label: 'Result', edit: { field: 'result_norm', type: 'select', options: RESULTS } },
    { key: 'description', label: 'Description', edit: { field: 'description', type: 'text' } },
    { key: 'receiver_company', label: 'Receiver', edit: { field: 'receiver_company', type: 'text' } },
    { key: 'grade', label: 'Grade', edit: { field: 'grade', type: 'text' } },
    { key: 'comments', label: 'Comments', edit: { field: 'comments', type: 'text' } },
  ],
  // Exact field names from specialty-samples' POST createSchema (api/src/routes/specialty-samples.ts).
  // Omits: `ref` (server issues it via issueRef when absent), `qty_grams` (typed sort-only
  // companion of `qty`), `client_id` (uuid FK — no client picker in this track's scope).
  createFields: [
    { key: 'description', label: 'Description', type: 'text', required: true },
    { key: 'receiver_company', label: 'Receiver', type: 'text', required: true },
    { key: 'sample_type_norm', label: 'Sample Type', type: 'select', options: SAMPLE_TYPES, defaultValue: 'other' },
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'grade', label: 'Grade', type: 'text' },
    { key: 'outturn', label: 'Outturn', type: 'text' },
    { key: 'bags', label: 'Bags', type: 'number' },
    { key: 'awb', label: 'AWB', type: 'text' },
    { key: 'courier_norm', label: 'Courier', type: 'select', options: COURIERS },
    { key: 'qty', label: 'Qty', type: 'text' },
    { key: 'crop_year', label: 'Crop Year', type: 'text' },
    { key: 'comments', label: 'Comments', type: 'text' },
  ],
};
