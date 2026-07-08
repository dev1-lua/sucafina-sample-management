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

export type SearchHit = { tab: string; id: string; ref: string | null; title: string | null; receiver: string | null; status: string; awb: string | null };
export function useSearch(q: string) {
  return useQuery({
    queryKey: ['/search', q],
    queryFn: () => api<{ data: SearchHit[]; total: number }>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
  });
}
