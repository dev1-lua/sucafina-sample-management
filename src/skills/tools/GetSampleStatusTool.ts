import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class GetSampleStatusTool implements LuaTool {
  name = 'get_sample_status';
  description = 'Full detail + event timeline for one sample by ref or id.';

  inputSchema = z.object({
    ref_or_id: z.string().describe('Sample ref like "SL-8000" or a uuid'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(input.ref_or_id);
    if (isUuid) return apiFetch(`/samples/${input.ref_or_id}`);
    const res = await apiFetch(`/samples?q=${encodeURIComponent(input.ref_or_id)}&pageSize=1`);
    if (!res.data[0]) return { found: false, message: `No sample matching "${input.ref_or_id}"` };
    return apiFetch(`/samples/${res.data[0].id}`);
  }
}
