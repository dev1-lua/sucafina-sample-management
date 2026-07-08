import { StatusBadge } from '@/components/StatusBadge';
import type { TabConfig } from './registry';

// Enums verbatim from the API's forwarding-samples router / global constraints.
// Forwarding's lifecycle omits `results_in` (no result_norm on this table).
const STATUSES = ['requested', 'preparing', 'dispatched', 'delivered', 'cancelled'];
const COURIERS = ['dhl', 'fedex', 'ups', 'rider', 'hand_delivery', 'client_pickup', 'other'];

export const forwardingConfig: TabConfig = {
  endpoint: '/forwarding-samples',
  path: '/forwarding',
  entityLabel: 'Forwarding Sample',
  columns: [
    { key: 'date', header: 'Date', sortKey: 'date_on' },
    { key: 'sender', header: 'Sender', sortKey: 'sender' },
    { key: 'origin', header: 'Origin', sortKey: 'origin' },
    { key: 'sample_ref', header: 'Sample Ref', sortKey: 'sample_ref' },
    { key: 'coffee_quality', header: 'Coffee Quality' },
    { key: 'receiver_company', header: 'Receiver', sortKey: 'receiver_company' },
    { key: 'id_number', header: 'ID Number', sortKey: 'id_number' },
    { key: 'awb', header: 'AWB', edit: { field: 'awb', type: 'text' } },
    { key: 'courier', header: 'Courier', edit: { field: 'courier_norm', type: 'select', options: COURIERS } },
    { key: 'qty', header: 'Qty', sortKey: 'qty_grams' },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      render: (r) => <StatusBadge kind="status" value={r.status as string | null} />,
    },
  ],
  filters: [
    { key: 'status', label: 'Status', type: 'enum', options: STATUSES, multi: true },
    { key: 'courier_norm', label: 'Courier', type: 'enum', options: COURIERS },
    { key: 'origin', label: 'Origin', type: 'text' },
    { key: 'sender', label: 'Sender', type: 'text' },
    { key: 'date_range', label: 'Date', type: 'date' },
    { key: 'has_awb', label: 'Has AWB', type: 'bool' },
    { key: 'has_id', label: 'Has ID', type: 'bool' },
  ],
  detailFields: [
    { key: 'status', label: 'Status', edit: { field: 'status', type: 'select', options: STATUSES } },
    { key: 'awb', label: 'AWB', edit: { field: 'awb', type: 'text' } },
    { key: 'courier', label: 'Courier', edit: { field: 'courier_norm', type: 'select', options: COURIERS } },
  ],
};
