import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class FindOpenSamplesTool implements LuaTool {
  name = 'find_open_samples';
  description = 'List samples not yet dispatched (status requested/preparing), optionally filtered by client/receiver text.';

  inputSchema = z.object({
    query: z.string().optional().describe('Client or receiver text, e.g. "beyers"'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const q = input.query ? `&q=${encodeURIComponent(input.query)}` : '';
    const res = await apiFetch(`/samples?status=requested,preparing${q}&pageSize=50`);
    return {
      total: res.total,
      samples: res.data.map((s: any) => ({
        id: s.id, ref: s.ref ?? s.ref_raw, quality: s.quality, receiver: s.receiver,
        sample_type: s.sample_type, deadline: s.deadline,
      })),
    };
  }
}
