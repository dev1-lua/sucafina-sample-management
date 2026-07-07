import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class SearchSamplesTool implements LuaTool {
  name = 'search_samples';
  description = 'Search sample records by text, status, type, or flags (overdue / awaiting results).';

  inputSchema = z.object({
    q: z.string().optional().describe('Text over ref/quality/receiver'),
    status: z.string().optional().describe('Comma list: requested,preparing,dispatched,delivered,results_in,cancelled'),
    sample_type: z.enum(['offer', 'type', 'pss', 'woc', 'retention', 'flavor_mapping', 'marketing', 'calibration', 'other']).optional(),
    overdue: z.boolean().optional(),
    awaiting_results: z.boolean().optional(),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const p = new URLSearchParams({ pageSize: '25' });
    if (input.q) p.set('q', input.q);
    if (input.status) p.set('status', input.status);
    if (input.sample_type) p.set('sample_type', input.sample_type);
    if (input.overdue) p.set('overdue', 'true');
    if (input.awaiting_results) p.set('awaiting_results', 'true');
    const res = await apiFetch(`/samples?${p}`);
    return {
      total: res.total,
      samples: res.data.map((s: any) => ({
        id: s.id, ref: s.ref ?? s.ref_raw, quality: s.quality, receiver: s.receiver,
        sample_type: s.sample_type, status: s.status, courier: s.courier, awb: s.awb,
        deadline: s.deadline, result: s.result,
      })),
    };
  }
}
