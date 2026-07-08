import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { TABS } from '../../lib/normalize';

export default class FindOpenSamplesTool implements LuaTool {
  name = 'find_open_samples';
  description =
    'List samples not yet dispatched (status requested/preparing) across specialty/bulk/forwarding, optionally filtered by client/receiver/ref text. Returns each hit\'s tab + id, needed to record a dispatch on the right table. Up to 100 per page; `total` is the TRUE count — when `has_more` is true, report the total and offer to narrow or fetch the next `page` rather than implying the shown rows are all of them.';

  inputSchema = z.object({
    query: z.string().optional().describe('Client, receiver, or ref text, e.g. "beyers"'),
    tab: z.enum(TABS).optional().describe('Restrict to one table if already known'),
    page: z.number().int().min(1).optional().describe('1-based page to fetch (100 per page).'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const pageSize = 100;
    const page = input.page ?? 1;
    const p = new URLSearchParams({ status: 'requested,preparing', pageSize: String(pageSize), page: String(page) });
    if (input.query) p.set('q', input.query);
    if (input.tab) p.set('tab', input.tab);
    const res = await apiFetch(`/search?${p}`);
    return {
      total: res.total,
      page,
      page_size: pageSize,
      returned: res.data.length,
      has_more: page * pageSize < res.total,
      samples: res.data.map((s: any) => ({
        tab: s.tab,
        id: s.id,
        ref: s.ref,
        title: s.title,
        receiver: s.receiver,
        status: s.status,
      })),
    };
  }
}
