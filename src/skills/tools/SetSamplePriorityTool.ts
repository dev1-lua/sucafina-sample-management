import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
import { TABS, TAB_ENDPOINT, type Tab } from '../../lib/normalize';

export default class SetSamplePriorityTool implements LuaTool {
  name = 'set_sample_priority';
  description =
    'Flag an existing sample as urgent (or back to normal) — feedback #25. Pass tab + id if you already have them (from search_samples / find_open_samples), or just the ref (e.g. "TYPE-1006") and it resolves the row. Returns the updated row card fields.';

  inputSchema = z.object({
    priority: z.enum(['urgent', 'normal']).describe('"urgent" to flag, "normal" to clear.'),
    ref: z.string().optional().describe('Sample ref, e.g. "TYPE-1006", "SSKE-108291", "SL-8007".'),
    tab: z.enum(TABS).optional().describe('Table the sample lives in, when known.'),
    id: z.string().optional().describe('Sample row id, when known.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    let tab: Tab | undefined = input.tab;
    let id = input.id;
    if (!id) {
      const ref = (input.ref ?? '').trim();
      if (!ref) throw new Error('Pass a ref, or tab + id, to identify the sample.');
      const p = new URLSearchParams({ q: ref, pageSize: '100' });
      if (tab) p.set('tab', tab);
      const res = await apiFetch(`/search?${p}`);
      const norm = (s: string) => s.replace(/[\s\-_]/g, '').toLowerCase();
      const hits = (res.data ?? []).filter((r: any) => norm(String(r.ref ?? '')) === norm(ref));
      if (hits.length === 0) throw new Error(`No sample with ref "${ref}" — check the ref with search_samples.`);
      if (hits.length > 1) {
        const list = hits.map((r: any) => `${r.ref} (${r.tab}, ${r.title} → ${r.receiver})`).join('; ');
        throw new Error(`Several rows share ref "${ref}": ${list}. Ask which one, then retry with tab + id.`);
      }
      tab = hits[0].tab as Tab;
      id = hits[0].id as string;
    }
    if (!tab) throw new Error('tab is required when passing an id.');
    const row = await apiFetch(`/${TAB_ENDPOINT[tab]}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ priority: input.priority }),
    });
    return {
      tab,
      id: row.id,
      ref: row.ref ?? row.sample_ref,
      title: row.description ?? row.quality ?? row.coffee_quality,
      receiver: row.receiver_company ?? row.client,
      status: row.status,
      priority: row.priority,
      url: dashboardUrl(tab, row.id, 'updated'),
    };
  }
}
