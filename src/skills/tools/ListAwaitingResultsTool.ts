import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class ListAwaitingResultsTool implements LuaTool {
  name = 'list_awaiting_results';
  description =
    'List delivered specialty/bulk samples that still have no recorded result. Forwarding never reaches a result stage and is excluded. `total` is the TRUE count of everything awaiting a result (from the stats aggregate); `samples` is the first page of examples — when `has_more` is true, report the total and offer oldest-first or a client filter rather than implying the examples are all of them.';

  inputSchema = z.object({});

  async execute() {
    // TRUE count comes from the stats aggregate, whose `awaiting_results` is defined
    // server-side as exactly delivered + no result + not forwarding — the same predicate
    // we filter on below. (The old `total: items.length` only ever counted the first
    // page of delivered rows, badly undercounting once there were >100.)
    const stats = await apiFetch('/stats');
    const res = await apiFetch('/search?status=delivered&pageSize=100&page=1');
    const items = res.data.filter((s: any) => s.tab !== 'forwarding' && !s.result_norm);
    const total = typeof stats?.awaiting_results === 'number' ? stats.awaiting_results : items.length;
    const samples = items.slice(0, 25).map((s: any) => ({
      tab: s.tab,
      id: s.id,
      ref: s.ref,
      title: s.title,
      receiver: s.receiver,
      country: s.country,
      awb: s.awb,
      date: s.date_on,
      delivery_date: s.delivery_on,
    }));
    return {
      total,
      returned: samples.length,
      has_more: total > samples.length,
      samples,
    };
  }
}
