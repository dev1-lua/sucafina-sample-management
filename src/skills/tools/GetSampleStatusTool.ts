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
    // Pull a few candidates rather than blindly taking data[0]: when a query matches more than one
    // sample (e.g. "AA FAQ" or a receiver name), we return the most recent one's full detail AND a
    // short list of the other matches so the assistant can disambiguate instead of silently guessing.
    const res = await apiFetch(`/search?q=${encodeURIComponent(input.ref_or_id)}&pageSize=5`);
    const hits = (res.data ?? []) as Array<{
      tab: 'specialty' | 'bulk' | 'forwarding'; id: string;
      ref: string | null; title: string | null; receiver: string | null; status: string | null;
    }>;
    if (!hits.length) return { found: false, message: `No sample matching "${input.ref_or_id}"` };
    const top = hits[0];
    const detail = await apiFetch(`/${TAB_ENDPOINT[top.tab]}/${top.id}`);
    if (hits.length === 1) return detail;
    return {
      ...detail,
      _note: `${hits.length} samples matched "${input.ref_or_id}"; showing the most recent. Ask by ref to pick another.`,
      other_matches: hits.slice(1).map((h) => ({
        ref: h.ref, tab: h.tab, title: h.title, receiver: h.receiver, status: h.status,
      })),
    };
  }
}
