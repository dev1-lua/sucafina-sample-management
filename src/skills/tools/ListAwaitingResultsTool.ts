import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class ListAwaitingResultsTool implements LuaTool {
  name = 'list_awaiting_results';
  description =
    'List delivered specialty/bulk samples that still have no recorded result. Forwarding never reaches a result stage and is excluded.';

  inputSchema = z.object({});

  async execute() {
    const res = await apiFetch('/search?status=delivered&pageSize=100');
    const items = res.data.filter((s: any) => s.tab !== 'forwarding' && !s.result_norm);
    return {
      total: items.length,
      samples: items.slice(0, 25).map((s: any) => ({
        tab: s.tab,
        id: s.id,
        ref: s.ref,
        title: s.title,
        receiver: s.receiver,
        delivery_date: s.delivery_on,
      })),
    };
  }
}
