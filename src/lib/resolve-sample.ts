import { apiFetch } from './api';
import { TAB_ENDPOINT, type Tab } from './normalize';

/**
 * Resolve a sample ref ("TYPE-1006", "SL-8007", "SSKE-108291") to its book + row id
 * via the cross-book search. Throws model-facing errors on no/ambiguous matches.
 */
export async function resolveSampleByRef(ref: string, tab?: Tab): Promise<{ tab: Tab; id: string }> {
  const wanted = ref.trim();
  if (!wanted) throw new Error('Pass a sample ref to identify the sample.');
  const p = new URLSearchParams({ q: wanted, pageSize: '100' });
  if (tab) p.set('tab', tab);
  const res = await apiFetch(`/search?${p}`);
  const norm = (s: string) => s.replace(/[\s\-_]/g, '').toLowerCase();
  const hits = (res.data ?? []).filter((r: any) => norm(String(r.ref ?? '')) === norm(wanted));
  if (hits.length === 0) throw new Error(`No sample with ref "${wanted}" — check the ref with search_samples.`);
  if (hits.length > 1) {
    const list = hits.map((r: any) => `${r.ref} (${r.tab}, ${r.title} → ${r.receiver})`).join('; ');
    throw new Error(`Several rows share ref "${wanted}": ${list}. Ask which one, then retry with tab.`);
  }
  return { tab: hits[0].tab as Tab, id: String(hits[0].id) };
}

export const sampleEndpoint = (tab: Tab) => `/${TAB_ENDPOINT[tab]}`;
