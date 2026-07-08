import { QueryClient, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { buildListParams } from './params';
import type { ListResult, ListQuery, EventRow } from '@/types';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
});

export function useRecords(endpoint: string, q: ListQuery) {
  const qs = buildListParams(q).toString();
  return useQuery({
    queryKey: [endpoint, 'list', qs],
    queryFn: () => api<ListResult<Record<string, unknown>>>(`${endpoint}?${qs}`),
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
    },
  });
}

export function useClients(q: ListQuery) { return useRecords('/clients', q); }

// --- Phase 4 mutations + aggregates -------------------------------------------------
// Create: POST /{endpoint} (server issues the ref); invalidate the tab's list on settle.
export function useCreateRecord(endpoint: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Record<string, unknown>>(endpoint, { method: 'POST', body: JSON.stringify(body) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [endpoint, 'list'] });
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
};
export function useStats() {
  return useQuery({ queryKey: ['/stats'], queryFn: () => api<StatsResult>('/stats') });
}

export type Trader = { id: string; name: string; role: string | null; email: string | null };
export function useTraders() {
  return useQuery({
    queryKey: ['/traders'],
    queryFn: () => api<{ data: Trader[]; total: number }>('/traders').then((r) => r.data),
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
