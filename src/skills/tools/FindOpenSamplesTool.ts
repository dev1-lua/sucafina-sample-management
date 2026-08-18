import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { TABS } from '../../lib/normalize';

export default class FindOpenSamplesTool implements LuaTool {
  name = 'find_open_samples';
  description =
    'List samples not yet dispatched (status requested/preparing) across specialty/commercial/forwarding, optionally filtered by client/receiver/ref text. Returns each hit\'s tab + id, needed to record a dispatch on the right table, plus its priority (urgent rows are listed first). Up to 100 per page; `total` is the TRUE count — when `has_more` is true, report the total and offer to narrow or fetch the next `page` rather than implying the shown rows are all of them.';

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
    // Urgent first, then the API's date order.
    res.data.sort((a: any, b: any) => Number(b.priority === 'urgent') - Number(a.priority === 'urgent'));
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
        country: s.country,
        sample_type: s.sample_type_norm,
        status: s.status,
        courier: s.courier_norm,
        awb: s.awb,
        phyto_cert: s.phyto_cert,
        location: s.location,
        // Stock check before dispatch: warn when stock_grams < qty_grams (null = untracked).
        qty_grams: s.qty_grams,
        stock_grams: s.stock_grams,
        // Urgency flag (feedback #25) — list urgent rows first when reporting.
        priority: s.priority ?? 'normal',
        date: s.date_on,
      })),
    };
  }
}
