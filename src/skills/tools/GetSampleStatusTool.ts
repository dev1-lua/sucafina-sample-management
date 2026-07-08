import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { TAB_ENDPOINT } from '../../lib/normalize';

export default class GetSampleStatusTool implements LuaTool {
  name = 'get_sample_status';
  description = 'Full detail + event timeline for one sample, resolved by ref/AWB/receiver text across all three tables.';

  inputSchema = z.object({
    ref_or_id: z.string().describe('Sample ref like "SL-8000", an AWB, or receiver text to match'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const res = await apiFetch(`/search?q=${encodeURIComponent(input.ref_or_id)}&pageSize=1`);
    const hit = res.data[0];
    if (!hit) return { found: false, message: `No sample matching "${input.ref_or_id}"` };
    return apiFetch(`/${TAB_ENDPOINT[hit.tab as 'specialty' | 'bulk' | 'forwarding']}/${hit.id}`);
  }
}
