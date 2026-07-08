import type { FilterDef } from '@/types';

// Enum domains, verbatim from the Postgres enum types (sample_status_t, courier_t,
// result_t, sample_type_t) — same values the tab configs use. `tab` is the fixed
// set of sample tables. Month + Country are open data domains, so their options are
// passed in from the (unfiltered) /stats response instead of hardcoded here.
const STATUSES = ['requested', 'preparing', 'dispatched', 'delivered', 'results_in', 'cancelled'];
const COURIERS = ['dhl', 'fedex', 'ups', 'rider', 'hand_delivery', 'client_pickup', 'other'];
const RESULTS = ['approved', 'rejected', 'pending_feedback'];
const SAMPLE_TYPES = ['offer', 'type', 'pss', 'woc', 'retention', 'flavor_mapping', 'marketing', 'calibration', 'other'];
const TABS = ['specialty', 'bulk', 'forwarding'];

/** Dashboard filter chips. `key` doubles as the /stats query param (see
 * buildStatsFilter in api/src/routes/stats.ts), so keep them in sync. Month/Country
 * options come from `stats.months` / `stats.countries`. */
export function dashboardFilterDefs(months: string[], countries: string[]): FilterDef[] {
  return [
    { key: 'month', label: 'Month', type: 'enum', options: months },
    { key: 'quality', label: 'Quality', type: 'text' },
    { key: 'tab', label: 'Tab', type: 'enum', options: TABS },
    { key: 'status', label: 'Status', type: 'enum', options: STATUSES, multi: true },
    { key: 'sample_type', label: 'Sample Type', type: 'enum', options: SAMPLE_TYPES },
    { key: 'country', label: 'Country', type: 'enum', options: countries },
    { key: 'courier', label: 'Courier', type: 'enum', options: COURIERS },
    { key: 'result', label: 'Result', type: 'enum', options: RESULTS },
  ];
}
