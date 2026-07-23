import { StatusBadge } from '@/components/StatusBadge';
import { CellValue } from '@/components/CellValue';
import { formatQty, formatLocation } from '@/lib/format';
import type { TabConfig } from './registry';
import { followupColumns, followupDetailFields } from './followup-fields';

// Lab locations Muki named (feedback ⑦); free text elsewhere, so the select allows custom entry.
const LOCATIONS = ['westlands', 'thika'];

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
  defaultSort: { sort: 'created_at', order: 'desc' },
  columns: [
    { key: 'date', header: 'Date', sortKey: 'date_on' },
    { key: 'ref', header: 'Ref', sortKey: 'ref' },
    { key: 'outturn', header: 'Outturn', defaultHidden: true },
    { key: 'name', header: 'Name', sortKey: 'name' },
    { key: 'country', header: 'Country', sortKey: 'country' },
    { key: 'grade', header: 'Grade', sortKey: 'grade' },
    // Feedback ④/⑦/⑩/⑪ (migration 007): location visible; blend/shipment month/contract number
    // are situational for specialty lots, so they ship hidden and can be toggled on.
    { key: 'location', header: 'Location', sortKey: 'location', render: (r) => <CellValue value={formatLocation(r.location)} /> },
    { key: 'blend', header: 'Blend', sortKey: 'blend', defaultHidden: true },
    { key: 'shipment_month', header: 'Shipment Month', sortKey: 'shipment_month', defaultHidden: true },
    { key: 'contract_number', header: 'Contract #', sortKey: 'contract_number', defaultHidden: true },
    // Feedback ⑬ (migration 009): strategy + cup-profile highlights on approved samples.
    { key: 'strategy', header: 'Strategy', sortKey: 'strategy', defaultHidden: true },
    { key: 'highlights', header: 'Highlights', sortKey: 'highlights', defaultHidden: true },
    { key: 'bags', header: 'Bags', defaultHidden: true },
    { key: 'description', header: 'Description', sortKey: 'description', defaultHidden: true },
    { key: 'receiver_company', header: 'Receiver', sortKey: 'receiver_company' },
    { key: 'awb', header: 'AWB', sortKey: 'awb' },
    // Display source is `courier_norm` — the only courier field the API ever writes
    // (the raw `courier` column is legacy-import-only and always empty for app data).
    // Sort by that same normalized column.
    { key: 'courier', header: 'Courier', sortKey: 'courier_norm', render: (r) => <CellValue value={r.courier_norm} humanize /> },
    // Feedback ⑨: quantity is now visible and unit-formatted (kg ≥1000 g, else g) off qty_grams,
    // falling back to the raw qty text when there's no numeric value.
    { key: 'qty', header: 'Qty', sortKey: 'qty_grams', render: (r) => <CellValue value={formatQty(r.qty_grams) ?? r.qty} /> },
    { key: 'delivery_date', header: 'Delivery Date', sortKey: 'delivery_on' },
    {
      key: 'result',
      header: 'Result',
      sortKey: 'result_norm',
      render: (r) => <StatusBadge kind="result" value={r.result_norm as string | null} />,
    },
    // Feedback ⑤: rejection reason, only shown when the result is a rejection.
    { key: 'rejection_reason', header: 'Rejection Reason', sortKey: 'rejection_reason', defaultHidden: true, render: (r) => <CellValue value={r.result_norm === 'rejected' ? r.rejection_reason : null} /> },
    { key: 'phyto_cert', header: 'Phyto Cert', sortKey: 'phyto_cert', defaultHidden: true },
    { key: 'comments', header: 'Comments', defaultHidden: true },
    { key: 'crop_year', header: 'Crop Year', defaultHidden: true },
    { key: 'crop_area_details', header: 'Crop Area Details', defaultHidden: true },
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
    { key: 'sample_type_norm', label: 'Sample Type', type: 'enum', options: SAMPLE_TYPES, multi: true },
    { key: 'courier_norm', label: 'Courier', type: 'enum', options: COURIERS, multi: true },
    { key: 'result_norm', label: 'Result', type: 'enum', options: RESULTS, multi: true },
    { key: 'location', label: 'Location', type: 'enum', options: LOCATIONS, multi: true },
    { key: 'country', label: 'Country', type: 'text' },
    { key: 'shipment_month', label: 'Shipment Month', type: 'text' },
    { key: 'date_range', label: 'Date', type: 'date' },
    { key: 'has_awb', label: 'Has AWB', type: 'bool' },
  ],
  detailFields: [
    { key: 'status', label: 'Status', edit: { field: 'status', type: 'select', options: STATUSES } },
    { key: 'awb', label: 'AWB', edit: { field: 'awb', type: 'text' } },
    { key: 'courier', label: 'Courier', edit: { field: 'courier_norm', type: 'select', options: COURIERS, allowCustom: true } },
    { key: 'result', label: 'Result', edit: { field: 'result_norm', type: 'select', options: RESULTS } },
    { key: 'rejection_reason', label: 'Rejection Reason', edit: { field: 'rejection_reason', type: 'text' } },
    { key: 'description', label: 'Description', edit: { field: 'description', type: 'text' } },
    { key: 'receiver_company', label: 'Receiver', edit: { field: 'receiver_company', type: 'text' } },
    { key: 'country', label: 'Country', edit: { field: 'country', type: 'text' } },
    { key: 'grade', label: 'Grade', edit: { field: 'grade', type: 'text' } },
    { key: 'blend', label: 'Blend', edit: { field: 'blend', type: 'text' } },
    { key: 'strategy', label: 'Strategy', edit: { field: 'strategy', type: 'text' } },
    { key: 'highlights', label: 'Highlights', edit: { field: 'highlights', type: 'text' } },
    { key: 'location', label: 'Location', edit: { field: 'location', type: 'select', options: LOCATIONS, allowCustom: true } },
    { key: 'shipment_month', label: 'Shipment Month', edit: { field: 'shipment_month', type: 'text' } },
    { key: 'contract_number', label: 'Contract #', edit: { field: 'contract_number', type: 'text' } },
    { key: 'phyto_cert', label: 'Phyto Cert', edit: { field: 'phyto_cert', type: 'text' } },
    { key: 'comments', label: 'Comments', edit: { field: 'comments', type: 'text' } },
    ...followupDetailFields,
  ],
  // Exact field names from specialty-samples' POST createSchema (api/src/routes/specialty-samples.ts).
  // Omits: `ref` (server issues it via issueRef when absent), `qty_grams` (typed sort-only
  // companion of `qty`), `client_id` (uuid FK — no client picker in this track's scope).
  createFields: [
    { key: 'description', label: 'Description', type: 'text', required: true },
    { key: 'receiver_company', label: 'Receiver', type: 'text', required: true },
    { key: 'sample_type_norm', label: 'Sample Type', type: 'select', options: SAMPLE_TYPES, defaultValue: 'other', allowCustom: true },
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'country', label: 'Country', type: 'text' },
    { key: 'grade', label: 'Grade', type: 'text' },
    { key: 'outturn', label: 'Outturn', type: 'text' },
    { key: 'bags', label: 'Bags', type: 'number' },
    { key: 'awb', label: 'AWB', type: 'text' },
    { key: 'courier_norm', label: 'Courier', type: 'select', options: COURIERS, allowCustom: true },
    { key: 'qty', label: 'Qty', type: 'text' },
    { key: 'blend', label: 'Blend', type: 'text' },
    { key: 'strategy', label: 'Strategy', type: 'text' },
    { key: 'highlights', label: 'Highlights', type: 'text' },
    { key: 'location', label: 'Location', type: 'select', options: LOCATIONS, allowCustom: true },
    { key: 'shipment_month', label: 'Shipment Month', type: 'text' },
    { key: 'contract_number', label: 'Contract #', type: 'text' },
    { key: 'crop_year', label: 'Crop Year', type: 'text' },
    { key: 'phyto_cert', label: 'Phyto Cert', type: 'text' },
    { key: 'comments', label: 'Comments', type: 'text' },
  ],
};
