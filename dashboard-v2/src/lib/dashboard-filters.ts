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
 * buildStatsFilter in api/src/routes/stats.ts), so keep them in sync. Month/Country/Quality
 * options come from `stats.months` / `stats.countries` / `stats.qualities`. Quality is a
 * multi-select searchable dropdown (free text, ~hundreds of values) matched by ILIKE. */
export function dashboardFilterDefs(months: string[], countries: string[], qualities: string[]): FilterDef[] {
  return [
    { key: 'month', label: 'Month', type: 'enum', options: months, multi: true },
    { key: 'quality', label: 'Quality', type: 'enum', options: qualities, searchable: true, multi: true },
    { key: 'tab', label: 'Tab', type: 'enum', options: TABS, multi: true },
    { key: 'status', label: 'Status', type: 'enum', options: STATUSES, multi: true },
    { key: 'sample_type', label: 'Sample Type', type: 'enum', options: SAMPLE_TYPES, multi: true },
    { key: 'country', label: 'Country', type: 'enum', options: countries, multi: true },
    { key: 'courier', label: 'Courier', type: 'enum', options: COURIERS, multi: true },
    { key: 'result', label: 'Result', type: 'enum', options: RESULTS, multi: true },
  ];
}
