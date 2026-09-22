import { apiFetch } from '../../lib/api';
import { resolveSampleByRef } from '../../lib/resolve-sample';
import type { Tab } from '../../lib/normalize';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a consignment reference — a "CN-1000" number or a raw uuid — to its {id, number}. */
export async function resolveConsignment(ref: string): Promise<{ id: string; number: string } | null> {
  if (UUID_RE.test(ref)) {
    try {
      const c = await apiFetch(`/consignments/${ref}`);
      return { id: c.id, number: c.number };
    } catch {
      return null;
    }
  }
  const res = await apiFetch(`/consignments?q=${encodeURIComponent(ref)}&pageSize=10`);
  const data = (res.data ?? []) as Array<{ id: string; number: string }>;
  const hit = data.find((c) => c.number?.toLowerCase() === ref.toLowerCase()) ?? data[0];
  return hit ? { id: hit.id, number: hit.number } : null;
}

export type ResolvedSample = { tab: Tab; id: string; ref: string };

/**
 * Resolve a list of sample refs to {tab, id} through the one resolver (a ref names the coffee and may
 * have several sends — `receiver` narrows; an ambiguous ref comes back in `missing` with the
 * "which receiver?" reason rather than the first row the search happened to return).
 */
export async function resolveSamples(refs: string[], opts: { receiver?: string } = {}): Promise<{ found: ResolvedSample[]; missing: Array<{ ref: string; reason: string }> }> {
  const found: ResolvedSample[] = [];
  const missing: Array<{ ref: string; reason: string }> = [];
  for (const r of refs) {
    try {
      const hit = await resolveSampleByRef(r, opts);
      found.push({ tab: hit.tab, id: hit.id, ref: hit.ref });
    } catch (e) {
      missing.push({ ref: r, reason: (e as Error)?.message ?? String(e) });
    }
  }
  return { found, missing };
}

/** POST resolved samples to a consignment, one request per book (the API takes one tab at a time). */
export async function attachSamples(consignmentId: string, samples: Array<{ tab: Tab; id: string }>): Promise<number> {
  let added = 0;
  for (const tab of ['specialty', 'bulk', 'forwarding'] as const) {
    const ids = samples.filter((s) => s.tab === tab).map((s) => s.id);
    if (!ids.length) continue;
    const res = await apiFetch(`/consignments/${consignmentId}/samples`, {
      method: 'POST',
      body: JSON.stringify({ tab, ids }),
    });
    added += res.added ?? 0;
  }
  return added;
}
