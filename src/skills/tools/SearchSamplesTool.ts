import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { TABS } from '../../lib/normalize';

export default class SearchSamplesTool implements LuaTool {
  name = 'search_samples';
  description =
    'Search sample records by text, status, table, or AWB across specialty, bulk, and forwarding. Returns each hit\'s tab + id (needed to update the correct table).';

  inputSchema = z.object({
    q: z.string().optional().describe('Text over ref/title/receiver/awb'),
    tab: z.enum(TABS).optional().describe('Restrict to one table: specialty, bulk, or forwarding'),
    status: z.string().optional().describe('Comma list: requested,preparing,dispatched,delivered,results_in,cancelled'),
    awb: z.string().optional().describe('Exact AWB/tracking number'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const p = new URLSearchParams({ pageSize: '25' });
    if (input.q) p.set('q', input.q);
    if (input.tab) p.set('tab', input.tab);
    if (input.status) p.set('status', input.status);
    if (input.awb) p.set('awb', input.awb);
    const res = await apiFetch(`/search?${p}`);
    return {
      total: res.total,
      samples: res.data.map((s: any) => ({
        tab: s.tab,
        id: s.id,
        ref: s.ref,
        title: s.title,
        receiver: s.receiver,
        status: s.status,
        courier: s.courier_norm,
        awb: s.awb,
        date: s.date_on,
        delivery_date: s.delivery_on,
        result: s.result_norm,
      })),
    };
  }
}
