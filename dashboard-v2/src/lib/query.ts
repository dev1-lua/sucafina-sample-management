import { QueryClient, useQuery, useQueries, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from './api';
import { buildListParams } from './params';
import type { ListResult, ListQuery, EventRow, Digest, FilterState } from '@/types';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
});

export function useRecords(endpoint: string, q: ListQuery) {
  const qs = buildListParams(q).toString();
  return useQuery({
    queryKey: [endpoint, 'list', qs],
    queryFn: () => api<ListResult<Record<string, unknown>>>(`${endpoint}?${qs}`),
    // Keep the previous page's rows mounted while a filter/sort/page change fetches the
    // next set. Without this the query drops to `isLoading`, `rows` empties, and the
    // virtualized <tbody> (count N) is swapped for skeleton rows (count 0) and back —
    // which makes @tanstack/react-virtual's ResizeObserver re-measure a scroll height
    // that collapses then re-expands, wedging the main thread in a synchronous Blink
    // layout storm (the "CPU-idle, page-dead, reload-required" freeze; see
    // docs/incident-2026-07-08-list-page-freeze.md). Holding the rows keeps `count`
    // (and the scroll height) stable across the key change, so no re-measure storm.
    placeholderData: keepPreviousData,
  });
}

type Detail = Record<string, unknown> & { events?: EventRow[] };
export function useRecord(endpoint: string, id: string) {
  return useQuery({
    queryKey: [endpoint, 'detail', id],
    queryFn: () => api<Detail>(`${endpoint}/${id}`),
    enabled: !!id,
  });
}

export function usePatchRecord(endpoint: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown> }) =>
      api<Record<string, unknown>>(`${endpoint}/${vars.id}`, { method: 'PATCH', body: JSON.stringify(vars.body) }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: [endpoint, 'detail', vars.id] });
      const prev = qc.getQueryData<Detail>([endpoint, 'detail', vars.id]);
      if (prev) qc.setQueryData<Detail>([endpoint, 'detail', vars.id], { ...prev, ...vars.body });
      return { prev };
    },
    onError: (_e, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData([endpoint, 'detail', vars.id], ctx.prev);
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: [endpoint, 'detail', vars.id] });
      qc.invalidateQueries({ queryKey: [endpoint, 'list'] });
      invalidateLots(qc, endpoint);
    },
  });
}

export function useClients(q: ListQuery) { return useRecords('/clients', q); }

// --- Lots (round 10) -------------------------------------------------------------------------
// A lot is what a ref names: the coffee. GET /lots lists one row per ref with a status
// roll-up of its sends (contracts §3, served through useRecords('/lots', …) so the Coffees
// view shares RecordTable's paging + keepPreviousData); GET /lots/:ref is the lot with its
// sends (§2), fetched when a coffee is expanded or its Related tab opens.
export const LOTS_ENDPOINT = '/lots';
export type LotBook = 'specialty' | 'commercial';
export type Lot = {
  ref: string; book: LotBook; coffee_key: string;
  outturn: string | null; grade: string | null; quality: string | null; blend: string | null;
  first_issued_at: string;
};
export type LotSend = {
  tab: string; id: string; receiver: string | null; date_on: string | null; status: string | null;
  qty_grams: number | null; courier_norm: string | null; awb: string | null;
  title?: string | null; consignment_number?: string | null;
};
export type LotDetail = { lot: Lot; sends: LotSend[] };

const lotDetailQuery = (ref: string) => ({
  queryKey: [LOTS_ENDPOINT, 'detail', ref] as const,
  queryFn: () => api<LotDetail>(`${LOTS_ENDPOINT}/${encodeURIComponent(ref)}`),
});

export function useLotSends(ref: string | null | undefined) {
  return useQuery({ ...lotDetailQuery(ref ?? ''), enabled: !!ref });
}

/** One detail query per expanded coffee, in `refs` order (the Coffees view keeps several open). */
export function useLotSendsMany(refs: string[]) {
  return useQueries({ queries: refs.map((ref) => lotDetailQuery(ref)) });
}

/** Sample writes change what the lot views show (sends, roll-ups) — refresh them alongside the book. */
function invalidateLots(qc: QueryClient, endpoint: string) {
  if (SAMPLE_ENDPOINTS.includes(endpoint)) qc.invalidateQueries({ queryKey: [LOTS_ENDPOINT] });
}

// --- Add a contact / delivery address to an existing client (migration 016) ---------------
export type ClientContactInput = {
  attention_to?: string | null;
  full_address?: string | null;
  phone?: string | null;
  email?: string | null;
};
const SAMPLE_ENDPOINTS = ['/specialty-samples', '/bulk-samples', '/forwarding-samples'];
/** POST /clients/:id/contacts (adds or merges a contact). A new address clears the
 * client's `address_missing` flag AND every sample row's `client_address_missing`, so
 * the client detail/list and all three sample books are refreshed on settle. */
export function useAddClientContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ClientContactInput) =>
      api<Record<string, unknown>>(`/clients/${id}/contacts`, { method: 'POST', body: JSON.stringify(body) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['/clients', 'detail', id] });
      qc.invalidateQueries({ queryKey: ['/clients', 'list'] });
      for (const endpoint of SAMPLE_ENDPOINTS) qc.invalidateQueries({ queryKey: [endpoint] });
    },
  });
}

// --- Merge duplicate clients (feedback #27) -----------------------------------------------------
export type MergeCandidate = {
  id: string; name: string; country: string | null;
  contact_count: number; sample_count: number; has_address: boolean;
};
/** Other live clients whose normalized name matches this one — pre-suggested merge targets. */
export function useMergeCandidates(id: string) {
  return useQuery({
    queryKey: ['/clients', 'merge-candidates', id],
    queryFn: () => api<{ normalized: string; data: MergeCandidate[] }>(`/clients/${id}/merge-candidates`),
    enabled: !!id,
    // The source is soft-deleted right after a merge; a refetch would 404 — don't retry it.
    retry: false,
  });
}

export type MergeResult = {
  target: Record<string, unknown> & { id: string; name: string };
  merged: Array<{ id: string; name: string }>;
  repointed: { specialty: number; bulk: number; forwarding: number; legacy: number };
  contacts_folded: number;
};
/** POST /clients/:target/merge — sources fold INTO the target; sources are soft-deleted server-side. */
export function useMergeClients() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { targetId: string; sourceIds: string[]; name?: string | null }) =>
      api<MergeResult>(`/clients/${vars.targetId}/merge`, {
        method: 'POST',
        body: JSON.stringify({ source_ids: vars.sourceIds, ...(vars.name ? { name: vars.name } : {}) }),
      }),
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ['/clients'] });
      for (const id of [vars.targetId, ...vars.sourceIds]) qc.invalidateQueries({ queryKey: ['/clients', 'detail', id] });
    },
  });
}

// --- Phase 4 mutations + aggregates -------------------------------------------------
// Create: POST /{endpoint} (server issues the ref); invalidate the tab's list on settle.
export function useCreateRecord(endpoint: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Record<string, unknown>>(endpoint, { method: 'POST', body: JSON.stringify(body) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [endpoint, 'list'] });
      invalidateLots(qc, endpoint);
    },
  });
}

// Delete: soft-delete via DELETE /{endpoint}/:id (server emits a `deleted` event).
export function useDeleteRecord(endpoint: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: boolean; id: string }>(`${endpoint}/${id}`, { method: 'DELETE' }),
    onSettled: (_d, _e, id) => {
      qc.invalidateQueries({ queryKey: [endpoint, 'list'] });
      qc.invalidateQueries({ queryKey: [endpoint, 'detail', id] });
      invalidateLots(qc, endpoint);
    },
  });
}

export type StatsResult = {
  by_status: Record<string, number>;
  by_tab: Record<string, number>;
  by_sample_type: Record<string, number>;
  by_result: Record<string, number>;
  by_courier: Record<string, number>;
  by_country: Record<string, number>;
  volume_over_time: { month: string; n: number }[];
  in_transit: number;
  awaiting_results: number;
  awaiting_results_aging: number;
  dispatched_this_week: number;
  // Feedback ⑮: approval outcomes per sample type + an overall rate. `total` = approved + rejected
  // (pending excluded); `rate` is the approved share of decided samples, null when none decided.
  approval_by_type: Record<string, { approved: number; rejected: number; total: number; rate: number | null }>;
  approval_rate: number | null;
  // Feedback ⑭: average delivered→result turnaround in days + the sample count it's based on.
  avg_feedback_days: number | null;
  feedback_sample_count: number;
  // Full-domain option lists for the dashboard filter dropdowns (server computes
  // these WITHOUT the active filters, so they never collapse). See stats.ts.
  months: string[];
  countries: string[];
  qualities: string[];
};

/** Serialize dashboard filter state into a `/stats` query string. Arrays go out as
 * repeated params (not comma-joined) so multi-select values that themselves contain
 * commas — a Quality string, or a country like "Hong Kong Sar,China" — survive the
 * round-trip; the API's buildStatsFilter reads either repeated params or a CSV string. */
function buildStatsQuery(filters: FilterState): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v == null) continue;
    if (Array.isArray(v)) { for (const item of v) if (item !== '') p.append(k, item); }
    else if (v !== '') p.set(k, v);
  }
  return p.toString();
}

export function useStats(filters: FilterState = {}) {
  const qs = buildStatsQuery(filters);
  return useQuery({
    queryKey: ['/stats', qs],
    queryFn: () => api<StatsResult>(qs ? `/stats?${qs}` : '/stats'),
    // Same freeze safeguard as useRecords: hold the previous stats while a filter
    // change refetches, so `isLoading` never flips true mid-interaction. That keeps
    // the charts (Recharts ResponsiveContainer + ResizeObserver) mounted instead of
    // being torn out for a skeleton and re-measured — the layout-storm wedge from
    // docs/incident-2026-07-08-list-page-freeze.md.
    placeholderData: keepPreviousData,
  });
}

export type Trader = { id: string; name: string; role: string | null; email: string | null };
export function useTraders() {
  return useQuery({
    queryKey: ['/traders'],
    queryFn: () => api<{ data: Trader[]; total: number }>('/traders').then((r) => r.data),
  });
}

// --- Team roster (Team page) --------------------------------------------------
// The roster drives the automatic notifications: QC members with an email get the
// new-request pings, the Sales Trader on a sample gets the status pings. ?all=1
// includes deactivated people so they can be reactivated. Mutations invalidate the
// ['/traders'] prefix, which also refreshes useTraders (account-owner selects).

export type TeamMember = { id: string; name: string; email: string | null; role: 'trader' | 'qc'; active: boolean };

export function useTeamRoster() {
  return useQuery({
    queryKey: ['/traders', 'roster'],
    queryFn: () => api<{ data: TeamMember[]; total: number }>('/traders?all=1').then((r) => r.data),
  });
}

export function usePatchTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: Partial<Pick<TeamMember, 'email' | 'role' | 'active'>> }) =>
      api<TeamMember>(`/traders/${vars.id}`, { method: 'PATCH', body: JSON.stringify(vars.body) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['/traders'] }),
  });
}

export function useCreateTeamMember() {
  const qc = useQueryClient();
  return useMutation({
    // POST /traders upserts on name — an existing name is updated, not duplicated.
    mutationFn: (body: { name: string; email?: string | null; role?: TeamMember['role'] }) =>
      api<TeamMember>('/traders', { method: 'POST', body: JSON.stringify(body) }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['/traders'] }),
  });
}

// --- Chaser digest ------------------------------------------------------------
// GET /chaser/digest returns 404 ("no digest yet") until the job/`Run now` has
// produced one. api() throws on non-2xx, so we swallow that specific 404 and
// resolve `null` — a clean "nothing yet" state instead of an error/retry spin.
export function useDigest() {
  return useQuery<Digest | null>({
    queryKey: ['/chaser/digest'],
    queryFn: async () => {
      try {
        return await api<Digest>('/chaser/digest');
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('404')) return null;
        throw e;
      }
    },
    retry: false,
  });
}

// POST /chaser/run recomputes + persists a digest (and audits each flagged row);
// it returns the fresh digest. Refresh the digest + dashboard stats on settle.
export function useRunChaser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Digest>('/chaser/run', { method: 'POST' }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['/chaser/digest'] });
      qc.invalidateQueries({ queryKey: ['/stats'] });
    },
  });
}

// --- Consignments (feedback ⑥⑦⑧) ---------------------------------------------------
export type Consignment = {
  id: string; number: string; location: string | null; status: string;
  notes: string | null; member_count: number; created_at: string;
};

// A send found by ref (contracts §5): the same ref can name several sends, so the caller
// picks which one when more than one comes back.
export type SampleCandidate = {
  tab: string; id: string; ref: string; title: string | null; receiver: string | null; status: string | null;
  date_on: string | null; consignment_number: string | null; awb: string | null; courier_norm: string | null;
};
/** GET /samples/resolve?ref= — exact (normalised) ref match, live rows, newest first; [] when none. */
export function resolveSampleRef(ref: string): Promise<SampleCandidate[]> {
  return api<{ ref: string; candidates: SampleCandidate[] }>(`/samples/resolve?ref=${encodeURIComponent(ref)}`).then((r) => r.candidates);
}

/** Membership and dispatch writes touch the sample rows too (consignment_number, status) — refresh everything. */
function invalidateConsignment(qc: QueryClient, id: string) {
  qc.invalidateQueries({ queryKey: ['/consignments', 'detail', id] });
  qc.invalidateQueries({ queryKey: ['/consignments', 'list'] });
  for (const endpoint of SAMPLE_ENDPOINTS) qc.invalidateQueries({ queryKey: [endpoint] });
  qc.invalidateQueries({ queryKey: [LOTS_ENDPOINT] });
}

// Add/remove member samples on a consignment (the API's membership endpoint takes {tab, ids}).
// Resolving a typed ref to a send is the page's job (resolveSampleRef + a picker when ambiguous).
export function useConsignmentMembers(id: string) {
  const qc = useQueryClient();
  const invalidate = () => invalidateConsignment(qc, id);
  const add = useMutation({
    mutationFn: (m: { tab: string; id: string }) =>
      api(`/consignments/${id}/samples`, { method: 'POST', body: JSON.stringify({ tab: m.tab, ids: [m.id] }) }),
    onSettled: invalidate,
  });
  const remove = useMutation({
    mutationFn: (m: { tab: string; id: string }) =>
      api(`/consignments/${id}/samples`, { method: 'DELETE', body: JSON.stringify({ tab: m.tab, ids: [m.id] }) }),
    onSettled: invalidate,
  });
  return { add, remove };
}

/** POST /consignments/:id/dispatch — the per-sample dispatch write applied to every live member. */
export function useDispatchConsignment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { courier: string; awb: string; dispatched_on?: string }) =>
      api<{ updated: number }>(`/consignments/${id}/dispatch`, { method: 'POST', body: JSON.stringify(body) }),
    onSettled: () => invalidateConsignment(qc, id),
  });
}

// --- Contracts + PSS (migration 020) ------------------------------------------------
/** GET /contracts/:id — the contract with its containers, their samples and its timeline. */
export function useContract(id: string) { return useRecord('/contracts', id); }

/**
 * POST /contracts/:id/draw-pss — raise the next PSS option for one slot. It writes a Commercial-book row
 * (ref derived from the contract: SSKE-<digits><letter>) and recomputes the contract's status, so both
 * the contract and the Commercial book are refreshed on settle.
 */
export function useDrawPss() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { contractId: string; containerNo: number }) =>
      api<{ id: string; sample_ref: string; contract_id: string; container_no: number }>(
        `/contracts/${vars.contractId}/draw-pss`,
        { method: 'POST', body: JSON.stringify({ container_no: vars.containerNo }) },
      ),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['/contracts'] });
      qc.invalidateQueries({ queryKey: ['/bulk-samples'] });
    },
  });
}

export type SearchHit = { tab: string; id: string; ref: string | null; title: string | null; receiver: string | null; status: string; awb: string | null };
export function useSearch(q: string) {
  return useQuery({
    queryKey: ['/search', q],
    queryFn: () => api<{ data: SearchHit[]; total: number }>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
  });
}

// --- Lot resolve + order creation (round 10, create dialog) ---------------------------------
// POST /lots/resolve is a pure read: given the coffee (and a typed ref, if any) it says whether
// the ref will be reused, freshly issued, or clashes with a lot that names another coffee
// (contracts §1). The create dialog calls it on blur so the notice shows before saving.
export type LotResolveRequest = {
  book: LotBook; ref: string | null;
  outturn: string | null; grade: string | null; quality: string | null; blend: string | null;
  sample_type: string | null;
};
export type LotResolveResult = {
  action: 'reuse' | 'new' | 'conflict';
  ref: string | null;
  lot: Lot | null;
  sends: LotSend[];
  reason?: string;
};
export function resolveLot(body: LotResolveRequest): Promise<LotResolveResult> {
  return api<LotResolveResult>(`${LOTS_ENDPOINT}/resolve`, { method: 'POST', body: JSON.stringify(body) });
}

/** The create routes answer 409 `{ error: 'ref_conflict', ref, lot, sends }` when a typed ref names
 * another coffee (contracts §4); api() folds that into `Error("409: <json>")`. Returns the parsed
 * conflict, or null for any other failure. */
export function parseRefConflict(err: unknown): LotResolveResult | null {
  if (!(err instanceof Error) || !err.message.startsWith('409:')) return null;
  try {
    const body = JSON.parse(err.message.slice(4).trim()) as { error?: string; ref?: string; lot?: Lot; sends?: LotSend[] };
    if (body.error !== 'ref_conflict') return null;
    return { action: 'conflict', ref: body.ref ?? null, lot: body.lot ?? null, sends: body.sends ?? [] };
  } catch {
    return null;
  }
}

export type CreateConsignmentInput = {
  location?: string | null; notes?: string | null; client_id?: string | null;
  requested_by?: string | null; logged_by?: string | null;
  samples?: Array<{ tab: string; id: string }>;
};
/** POST /consignments — an order, optionally with its samples attached in the same transaction (§6). */
export function useCreateConsignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateConsignmentInput) =>
      api<Consignment>('/consignments', { method: 'POST', body: JSON.stringify(body) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['/consignments', 'list'] });
      for (const endpoint of SAMPLE_ENDPOINTS) qc.invalidateQueries({ queryKey: [endpoint] });
      qc.invalidateQueries({ queryKey: [LOTS_ENDPOINT] });
    },
  });
}
