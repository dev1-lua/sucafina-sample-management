import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { normalizeRef, TAB_ENDPOINT } from '../../lib/normalize';
import { describeSend, isOpenSend, resolveSampleCandidates } from '../../lib/resolve-sample';

export default class GetSampleStatusTool implements LuaTool {
  name = 'get_sample_status';
  description =
    'Full detail + event timeline for one sample, resolved by ref/AWB/receiver text across all three tables. A ref names the COFFEE and can have several sends: "where is SL-7336?" with several sends returns them all as `sends` (one line each, open ones first) instead of guessing — pass receiver to pick one and get its full detail.';

  inputSchema = z.object({
    ref_or_id: z.string().describe('Sample ref like "SL-8000", an AWB, or receiver text to match'),
    receiver: z.string().optional().describe('Receiver / client name to pick one send when the ref has several, e.g. "TORCH".'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    // 1. Exact ref first (normalised): every live send of that coffee.
    const ref = normalizeRef(input.ref_or_id);
    if (ref) {
      const sends = await resolveSampleCandidates(ref, { receiver: input.receiver }).catch(() => []);
      if (sends.length === 1) return apiFetch(`/${TAB_ENDPOINT[sends[0]!.tab]}/${sends[0]!.id}`);
      if (sends.length > 1) {
        const open = sends.filter(isOpenSend).length;
        return {
          found: true,
          ref,
          _note: `${ref} has ${sends.length} sends (${open} open) — list them; ask "which receiver?" only if the person needs one send's detail and more than one is open.`,
          sends: sends.map((s) => ({
            tab: s.tab, id: s.id, receiver: s.receiver, status: s.status, date_on: s.date_on,
            consignment_number: s.consignment_number, courier: s.courier_norm, awb: s.awb, open: isOpenSend(s),
            line: describeSend(s),
          })),
        };
      }
    }
    // 2. Not a ref (an AWB, a receiver name…): the cross-book text search, a few candidates rather than
    //    blindly taking data[0], so the assistant can disambiguate instead of silently guessing.
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
