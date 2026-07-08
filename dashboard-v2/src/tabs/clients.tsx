import type { TabConfig } from './registry';

export const clientsConfig: TabConfig = {
  endpoint: '/clients',
  path: '/clients',
  entityLabel: 'Client',
  columns: [
    { key: 'name', header: 'Name', sortKey: 'name' },
    { key: 'country', header: 'Country', sortKey: 'country' },
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
