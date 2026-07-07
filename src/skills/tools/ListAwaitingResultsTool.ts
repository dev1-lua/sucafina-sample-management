import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class ListAwaitingResultsTool implements LuaTool {
  name = 'list_awaiting_results';
  description = 'List delivered samples that still have no recorded result/feedback.';

  inputSchema = z.object({});

  async execute() {
    const res = await apiFetch('/samples?awaiting_results=true&pageSize=25');
    return {
      total: res.total,
      samples: res.data.map((s: any) => ({
        id: s.id, ref: s.ref ?? s.ref_raw, quality: s.quality, receiver: s.receiver, delivered_at: s.delivered_at,
      })),
    };
  }
}
