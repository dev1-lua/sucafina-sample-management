import type { ColumnDef, CreateFieldDef, DetailField, FilterDef, SortState, TabKey } from '@/types';

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
  createFields?: CreateFieldDef[]; // drives CreateRecordDialog; omit for tabs with no create flow (e.g. clients)
  // Sort applied when the tab first loads (user clicks on headers still override it).
  // The sample books use created_at DESC — "just logged" always surfaces on top, which
  // date_on can't guarantee (imported rows may carry future dispatch dates).
  defaultSort?: SortState;
};

export const TAB_REGISTRY: Record<TabKey, TabConfig> = {
  specialty: specialtyConfig,
  bulk: bulkConfig,
  forwarding: forwardingConfig,
  clients: clientsConfig,
};
