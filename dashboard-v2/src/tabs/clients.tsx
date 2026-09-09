import { StatusBadge } from '@/components/StatusBadge';
import type { TabConfig } from './registry';

/** Same amber "Address needed" pill the sample books show, keyed off the client
 * list's own `address_missing` flag (migration 016). Nothing when an address is on file. */
function ClientAddressCell({ row }: { row: Record<string, unknown> }) {
  if (row.address_missing !== true) return null;
  return <StatusBadge kind="gap" value="address_needed" />;
}

export const clientsConfig: TabConfig = {
  endpoint: '/clients',
  path: '/clients',
  entityLabel: 'Client',
  columns: [
    { key: 'name', header: 'Name', sortKey: 'name' },
    { key: 'country', header: 'Country', sortKey: 'country' },
    { key: 'address_missing', header: 'Address', width: 130, render: (r) => <ClientAddressCell row={r} /> },
    { key: 'contact_count', header: 'Contacts' },
    { key: 'latest_order_date', header: 'Latest Order', sortKey: 'latest_order_date' },
  ],
  // The built-in search box (`q`) already covers Clients' only filter — no FilterDefs needed.
  filters: [],
  // Minimal, read-only — client drill-down (contacts/orders/account owner) is Phase 4.
  detailFields: [
    { key: 'name', label: 'Name' },
    { key: 'country', label: 'Country' },
  ],
};
