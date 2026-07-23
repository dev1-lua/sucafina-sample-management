import { StatusBadge } from '@/components/StatusBadge';
import { CellValue } from '@/components/CellValue';
import { formatQty, formatLocation } from '@/lib/format';
import type { TabConfig } from './registry';
import { followupColumns, followupDetailFields } from './followup-fields';

// Lab locations Muki named (feedback ⑦); free text elsewhere, so the select allows custom entry.
const LOCATIONS = ['westlands', 'thika'];

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
  // "Commercial" is the client-approved display name; the internal tab key / route / API
  // endpoint stay `bulk` (renaming those would break saved links and the DB discriminator).
  entityLabel: 'Commercial Sample',
  columns: [
    { key: 'date', header: 'Date', sortKey: 'date_on' },
    { key: 'sample_ref', header: 'Sample Ref', sortKey: 'sample_ref' },
    { key: 'bags', header: 'Bags', defaultHidden: true },
    { key: 'quality', header: 'Quality', sortKey: 'quality' },
    // Feedback ④/⑦/⑩/⑪ (migration 007): blend + location visible; shipment month + contract number
    // are situational (PSS) so ship hidden and can be toggled on.
    { key: 'blend', header: 'Blend', sortKey: 'blend' },
    { key: 'location', header: 'Location', sortKey: 'location', render: (r) => <CellValue value={formatLocation(r.location)} /> },
    { key: 'shipment_month', header: 'Shipment Month', sortKey: 'shipment_month', defaultHidden: true },
    { key: 'contract_number', header: 'Contract #', sortKey: 'contract_number', defaultHidden: true },
    // Feedback ⑬ (migration 009): strategy + cup-profile highlights on approved samples.
    { key: 'strategy', header: 'Strategy', sortKey: 'strategy', defaultHidden: true },
    { key: 'highlights', header: 'Highlights', sortKey: 'highlights', defaultHidden: true },
    { key: 'client_ref', header: 'Client Ref', defaultHidden: true },
    { key: 'ico_mark', header: 'ICO Mark', defaultHidden: true },
    {
      key: 'sample_type',
      header: 'Sample Type',
      sortKey: 'sample_type_norm',
      render: (r) => <StatusBadge kind="sample_type" value={r.sample_type_norm as string | null} />,
    },
    { key: 'client', header: 'Client', sortKey: 'client' },
    { key: 'country', header: 'Country', sortKey: 'country' },
    { key: 'awb', header: 'AWB', sortKey: 'awb' },
    // Display source is `courier_norm` — the only courier field the API ever writes
    // (the raw `courier` column is legacy-import-only and always empty for app data).
    // Sort by that same normalized column.
    { key: 'courier', header: 'Courier', sortKey: 'courier_norm', render: (r) => <CellValue value={r.courier_norm} humanize /> },
    // Feedback ⑨: quantity is now visible and unit-formatted (kg ≥1000 g, else g) off qty_grams,
    // falling back to the raw qty text when there's no numeric value.
    { key: 'qty', header: 'Qty', sortKey: 'qty_grams', render: (r) => <CellValue value={formatQty(r.qty_grams) ?? r.qty} /> },
    { key: 'moisture', header: 'Moisture', sortKey: 'moisture_pct', defaultHidden: true },
    { key: 'water_activity', header: 'Water Activity', sortKey: 'water_activity_num', defaultHidden: true },
    { key: 'delivery_date', header: 'Delivery Date', sortKey: 'delivery_on', defaultHidden: true },
    {
      key: 'result',
      header: 'Result',
      sortKey: 'result_norm',
      render: (r) => <StatusBadge kind="result" value={r.result_norm as string | null} />,
    },
    // Feedback ⑤: rejection reason, only meaningful (and only shown) when the result is a rejection.
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
    { key: 'moisture', label: 'Moisture %', type: 'numrange', minKey: 'moisture_min', maxKey: 'moisture_max' },
    { key: 'water', label: 'Water Activity', type: 'numrange', minKey: 'water_min', maxKey: 'water_max' },
    { key: 'has_awb', label: 'Has AWB', type: 'bool' },
  ],
  detailFields: [
    { key: 'status', label: 'Status', edit: { field: 'status', type: 'select', options: STATUSES } },
    { key: 'awb', label: 'AWB', edit: { field: 'awb', type: 'text' } },
    { key: 'courier', label: 'Courier', edit: { field: 'courier_norm', type: 'select', options: COURIERS, allowCustom: true } },
    { key: 'result', label: 'Result', edit: { field: 'result_norm', type: 'select', options: RESULTS } },
    { key: 'rejection_reason', label: 'Rejection Reason', edit: { field: 'rejection_reason', type: 'text' } },
    { key: 'quality', label: 'Quality', edit: { field: 'quality', type: 'text' } },
    { key: 'blend', label: 'Blend', edit: { field: 'blend', type: 'text' } },
    { key: 'strategy', label: 'Strategy', edit: { field: 'strategy', type: 'text' } },
    { key: 'highlights', label: 'Highlights', edit: { field: 'highlights', type: 'text' } },
    { key: 'location', label: 'Location', edit: { field: 'location', type: 'select', options: LOCATIONS, allowCustom: true } },
    { key: 'shipment_month', label: 'Shipment Month', edit: { field: 'shipment_month', type: 'text' } },
    { key: 'contract_number', label: 'Contract #', edit: { field: 'contract_number', type: 'text' } },
    { key: 'country', label: 'Country', edit: { field: 'country', type: 'text' } },
    { key: 'phyto_cert', label: 'Phyto Cert', edit: { field: 'phyto_cert', type: 'text' } },
    { key: 'comments', label: 'Comments', edit: { field: 'comments', type: 'text' } },
    ...followupDetailFields,
  ],
  // Exact field names from bulk-samples' POST createSchema (api/src/routes/bulk-samples.ts).
  // Note the enum field is `sample_type` here (not `sample_type_norm` as in specialty/filters).
  // Omits: `sample_ref` (the server now auto-issues a Commercial ref when it's left blank —
  // pss→SSKE, type→TYPE, else→SL — mirroring specialty; migration 006 + feedback ⑱),
  // `qty_grams`/`moisture_pct`/`water_activity_num` (typed sort-only companions of
  // qty/moisture/water_activity), and `client_id` (uuid FK — no client picker in this track's scope).
  createFields: [
    { key: 'quality', label: 'Quality', type: 'text', required: true },
    { key: 'client', label: 'Client', type: 'text', required: true },
    { key: 'sample_type', label: 'Sample Type', type: 'select', options: SAMPLE_TYPES, defaultValue: 'other', allowCustom: true },
    { key: 'country', label: 'Country', type: 'text' },
    { key: 'bags', label: 'Bags', type: 'number' },
    { key: 'client_ref', label: 'Client Ref', type: 'text' },
    { key: 'ico_mark', label: 'ICO Mark', type: 'text' },
    { key: 'awb', label: 'AWB', type: 'text' },
    { key: 'courier_norm', label: 'Courier', type: 'select', options: COURIERS, allowCustom: true },
    { key: 'qty', label: 'Qty', type: 'text' },
    { key: 'blend', label: 'Blend', type: 'text' },
    { key: 'strategy', label: 'Strategy', type: 'text' },
    { key: 'highlights', label: 'Highlights', type: 'text' },
    { key: 'location', label: 'Location', type: 'select', options: LOCATIONS, allowCustom: true },
    { key: 'shipment_month', label: 'Shipment Month', type: 'text' },
    { key: 'contract_number', label: 'Contract #', type: 'text' },
    { key: 'moisture', label: 'Moisture', type: 'text' },
    { key: 'water_activity', label: 'Water Activity', type: 'text' },
    { key: 'crop_year', label: 'Crop Year', type: 'text' },
    { key: 'phyto_cert', label: 'Phyto Cert', type: 'text' },
    { key: 'comments', label: 'Comments', type: 'text' },
  ],
};
