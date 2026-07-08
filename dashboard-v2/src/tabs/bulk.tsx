import { StatusBadge } from '@/components/StatusBadge';
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
    { key: 'bags', header: 'Bags' },
    { key: 'quality', header: 'Quality', sortKey: 'quality' },
    { key: 'client_ref', header: 'Client Ref' },
    { key: 'ico_mark', header: 'ICO Mark' },
    {
      key: 'sample_type',
      header: 'Sample Type',
      render: (r) => <StatusBadge kind="sample_type" value={r.sample_type_norm as string | null} />,
    },
    { key: 'client', header: 'Client', sortKey: 'client' },
    { key: 'country', header: 'Country', sortKey: 'country' },
    { key: 'awb', header: 'AWB', edit: { field: 'awb', type: 'text' } },
    { key: 'courier', header: 'Courier', edit: { field: 'courier_norm', type: 'select', options: COURIERS } },
    { key: 'qty', header: 'Qty', sortKey: 'qty_grams' },
    { key: 'moisture', header: 'Moisture', sortKey: 'moisture_pct' },
    { key: 'water_activity', header: 'Water Activity', sortKey: 'water_activity_num' },
    { key: 'delivery_date', header: 'Delivery Date', sortKey: 'delivery_on' },
    {
      key: 'result',
      header: 'Result',
      render: (r) => <StatusBadge kind="result" value={r.result_norm as string | null} />,
    },
    { key: 'comments', header: 'Comments' },
    { key: 'crop_year', header: 'Crop Year' },
    { key: 'crop_area_details', header: 'Crop Area Details' },
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
  ],
};
