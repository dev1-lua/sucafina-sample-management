import { StatusBadge } from '@/components/StatusBadge';
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
    { key: 'outturn', header: 'Outturn' },
    { key: 'name', header: 'Name' },
    { key: 'grade', header: 'Grade' },
    { key: 'bags', header: 'Bags' },
    { key: 'description', header: 'Description', sortKey: 'description' },
    { key: 'receiver_company', header: 'Receiver', sortKey: 'receiver_company' },
    { key: 'awb', header: 'AWB', edit: { field: 'awb', type: 'text' } },
    { key: 'courier', header: 'Courier', edit: { field: 'courier_norm', type: 'select', options: COURIERS } },
    { key: 'qty', header: 'Qty', sortKey: 'qty_grams' },
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
    { key: 'date_range', label: 'Date', type: 'date' },
    { key: 'has_awb', label: 'Has AWB', type: 'bool' },
  ],
  detailFields: [
    { key: 'status', label: 'Status', edit: { field: 'status', type: 'select', options: STATUSES } },
    { key: 'awb', label: 'AWB', edit: { field: 'awb', type: 'text' } },
    { key: 'courier', label: 'Courier', edit: { field: 'courier_norm', type: 'select', options: COURIERS } },
    { key: 'result', label: 'Result', edit: { field: 'result_norm', type: 'select', options: RESULTS } },
  ],
};
