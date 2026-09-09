import type { EventRow } from '@/types';

// Contracts + pre-shipment samples (migration 020). A contract ships N containers and owes one PSS
// per container 45 days before the shipment date; the container states below are derived from those
// samples' verdicts server-side (api/src/lib/contracts.ts), never set by hand.

export type ContractStatus =
  | 'open' | 'pss_pending' | 'pss_partial' | 'pss_rejected' | 'pss_approved' | 'shipped' | 'cancelled';

export type ContainerState = 'none' | 'pending' | 'approved' | 'replacement_pending' | 'failed';

/** Per-contract roll-up carried on every list row and on the detail response. */
export type PssCounts = { expected: number; approved: number; rejected: number; pending: number };

/** One PSS sample under a container (a Commercial-book row unless it was linked from Specialty). */
export type ContractPss = {
  tab: 'specialty' | 'bulk';
  id: string;
  ref: string | null;
  container_no: number | null;
  status: string;
  result_norm: string | null;
  replaces_sample_id: string | null;
  awb: string | null;
  dispatched_on: string | null;
  result_on: string | null;
};

export type ContractContainer = {
  container_no: number;
  state: ContainerState;
  samples: ContractPss[];
};

/** `GET /contracts/:id`: the contract row, its client, its containers, and the samples nothing claimed. */
export type ContractDetail = {
  id: string;
  contract_number: string;
  client_id: string | null;
  client_name: string | null;
  quality: string | null;
  destination: string | null;
  shipment_date: string | null;
  shipment_month: string | null;
  pss_due_date: string | null;
  // NB: on the detail response `containers` is the per-container array — it shadows the row's
  // integer count column, which only the list rows carry.
  containers: ContractContainer[];
  pss_expected: number;
  pss_counts: PssCounts;
  status: ContractStatus;
  notes: string | null;
  source: string | null;
  client: { id: string; name: string; account_owner: { id: string; name: string; email: string | null } | null } | null;
  unassigned: ContractPss[];
  events?: EventRow[];
};
