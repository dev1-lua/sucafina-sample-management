import type { ColumnDef, DetailField, FilterDef, TabKey } from '@/types';

import { specialtyConfig } from './specialty';
import { bulkConfig } from './bulk';
import { forwardingConfig } from './forwarding';
import { clientsConfig } from './clients';

export type TabConfig = {
  endpoint: string; // API router this tab's RecordTable/DetailDrawer hit (NEW routers, never legacy `/samples`)
  path: string; // frontend route (nav + drawer deep-link) — must match Sidebar's NAV_ITEMS
  entityLabel: string;
  columns: ColumnDef[];
  filters: FilterDef[];
  detailFields: DetailField[];
};

export const TAB_REGISTRY: Record<TabKey, TabConfig> = {
  specialty: specialtyConfig,
  bulk: bulkConfig,
  forwarding: forwardingConfig,
  clients: clientsConfig,
};
