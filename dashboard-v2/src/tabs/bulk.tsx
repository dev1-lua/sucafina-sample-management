import { StatusBadge } from '@/components/StatusBadge';
import { CellValue } from '@/components/CellValue';
import type { TabConfig } from './registry';

// Enums verbatim from the API's bulk-samples router / global constraints.
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

export const bulkConfig: TabConfig = {
  endpoint: '/bulk-samples',
  path: '/bulk',
  entityLabel: 'Bulk Sample',
  columns: [
    { key: 'date', header: 'Date', sortKey: 'date_on' },
    { key: 'sample_ref', header: 'Sample Ref', sortKey: 'sample_ref' },
    { key: 'bags', header: 'Bags', defaultHidden: true },
    { key: 'quality', header: 'Quality', sortKey: 'quality' },
    { key: 'client_ref', header: 'Client Ref', defaultHidden: true },
    { key: 'ico_mark', header: 'ICO Mark', defaultHidden: true },
    {
      key: 'sample_type',
      header: 'Sample Type',
      render: (r) => <StatusBadge kind="sample_type" value={r.sample_type_norm as string | null} />,
    },
    { key: 'client', header: 'Client', sortKey: 'client' },
    { key: 'country', header: 'Country', sortKey: 'country' },
    { key: 'awb', header: 'AWB' },
    // Display source is `courier_norm` — the only courier field the API ever writes
    // (the raw `courier` column is legacy-import-only and always empty for app data).
    { key: 'courier', header: 'Courier', render: (r) => <CellValue value={r.courier_norm} humanize /> },
    { key: 'qty', header: 'Qty', sortKey: 'qty_grams', defaultHidden: true },
    { key: 'moisture', header: 'Moisture', sortKey: 'moisture_pct', defaultHidden: true },
    { key: 'water_activity', header: 'Water Activity', sortKey: 'water_activity_num', defaultHidden: true },
    { key: 'delivery_date', header: 'Delivery Date', sortKey: 'delivery_on', defaultHidden: true },
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
    { key: 'country', label: 'Country', type: 'text' },
    { key: 'date_range', label: 'Date', type: 'date' },
    { key: 'moisture', label: 'Moisture %', type: 'numrange', minKey: 'moisture_min', maxKey: 'moisture_max' },
    { key: 'water', label: 'Water Activity', type: 'numrange', minKey: 'water_min', maxKey: 'water_max' },
    { key: 'has_awb', label: 'Has AWB', type: 'bool' },
  ],
  detailFields: [
    { key: 'status', label: 'Status', edit: { field: 'status', type: 'select', options: STATUSES } },
    { key: 'awb', label: 'AWB', edit: { field: 'awb', type: 'text' } },
    { key: 'courier', label: 'Courier', edit: { field: 'courier_norm', type: 'select', options: COURIERS } },
    { key: 'result', label: 'Result', edit: { field: 'result_norm', type: 'select', options: RESULTS } },
    { key: 'quality', label: 'Quality', edit: { field: 'quality', type: 'text' } },
    { key: 'country', label: 'Country', edit: { field: 'country', type: 'text' } },
    { key: 'comments', label: 'Comments', edit: { field: 'comments', type: 'text' } },
  ],
  // Exact field names from bulk-samples' POST createSchema (api/src/routes/bulk-samples.ts).
  // Note the enum field is `sample_type` here (not `sample_type_norm` as in specialty/filters).
  // Omits: `sample_ref` (optional + server-side never auto-issues it, but treated like a
  // ref for consistency with "server issues the ref" — leaving it blank is a known, accepted
  // gap since the API itself has no ref-issuance for bulk), `qty_grams`/`moisture_pct`/
  // `water_activity_num` (typed sort-only companions of qty/moisture/water_activity), and
  // `client_id` (uuid FK — no client picker in this track's scope).
  createFields: [
    { key: 'quality', label: 'Quality', type: 'text', required: true },
    { key: 'client', label: 'Client', type: 'text', required: true },
    { key: 'sample_type', label: 'Sample Type', type: 'select', options: SAMPLE_TYPES, defaultValue: 'other' },
    { key: 'country', label: 'Country', type: 'text' },
    { key: 'bags', label: 'Bags', type: 'number' },
    { key: 'client_ref', label: 'Client Ref', type: 'text' },
    { key: 'ico_mark', label: 'ICO Mark', type: 'text' },
    { key: 'awb', label: 'AWB', type: 'text' },
    { key: 'courier_norm', label: 'Courier', type: 'select', options: COURIERS },
    { key: 'qty', label: 'Qty', type: 'text' },
    { key: 'moisture', label: 'Moisture', type: 'text' },
    { key: 'water_activity', label: 'Water Activity', type: 'text' },
    { key: 'crop_year', label: 'Crop Year', type: 'text' },
    { key: 'comments', label: 'Comments', type: 'text' },
  ],
};
