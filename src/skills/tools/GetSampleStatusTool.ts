import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { normalizeRef, TAB_ENDPOINT } from '../../lib/normalize';
import { describeOption, describeSend, isOpenSend, resolveSampleCandidates } from '../../lib/resolve-sample';
import type { Lot } from '../../lib/lots';

/** A PSS contract base — SSKE-<digits> with no option letter. Rows carry the lettered refs; the base names the group. */
const PSS_BASE = /^SSKE-\d+$/;

/** One send of a PSS group as `GET /lots/:ref` lists it (contracts: sends carry option_letter). */
type GroupSend = {
  tab: 'specialty' | 'bulk'; id: string; ref: string; option_letter: string | null; receiver: string | null;
  date_on: string | null; status: string; qty_grams: number | null; courier_norm: string | null; awb: string | null; consignment_number: string | null;
};

export default class GetSampleStatusTool implements LuaTool {
  name = 'get_sample_status';
  description =
    'Full detail + event timeline for one sample, resolved by ref/AWB/receiver text across all three tables. A ref names the COFFEE and can have several sends: "where is SL-7336?" with several sends returns them all as `sends` (one line each, open ones first) instead of guessing — pass receiver to pick one and get its full detail. A PSS contract base ("where is SSKE-104929?", no letter) answers with the group: one line per option (A, B, C…) with receiver, status, date and courier/AWB — ask by the lettered ref for one option\'s full detail.';

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
      // 1b. "where is SSKE-104929?" — the rows carry the lettered options (SSKE-104929A, B…), so the exact
      //     resolve finds nothing for the base; the lots route knows the group.
      if (PSS_BASE.test(ref)) {
        const group = await this.pssGroup(ref, input.receiver);
        if (group) return group;
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

  /**
   * The PSS group behind a contract base: `GET /lots/SSKE-104929` → its live sends, one line per option
   * A→Z (a receiver narrows them). Null when no such group exists (404) — the text search runs instead.
   */
  private async pssGroup(base: string, receiver?: string) {
    let res: { lot: Lot; sends: GroupSend[] };
    try {
      res = await apiFetch(`/lots/${encodeURIComponent(base)}`);
    } catch (e) {
      if ((e as { status?: number })?.status !== 404) console.warn(`get_sample_status: GET /lots/${base} failed`, (e as Error)?.message ?? e);
      return null;
    }
    const all = res.sends ?? [];
    const wanted = receiver?.trim().toLowerCase();
    const sends = (wanted ? all.filter((s) => (s.receiver ?? '').toLowerCase().includes(wanted)) : all)
      .slice()
      .sort((a, b) => (a.option_letter ?? '~').localeCompare(b.option_letter ?? '~') || (b.date_on ?? '').localeCompare(a.date_on ?? ''));
    const options = [...new Set(all.map((s) => s.option_letter).filter((l): l is string => !!l))].sort();
    const open = sends.filter(isOpenSend).length;
    return {
      found: true,
      ref: base,
      pss_group: true,
      lot: res.lot,
      options,
      _note: `${base} is a PSS contract group with ${options.length} option${options.length === 1 ? '' : 's'} (${sends.length} send${sends.length === 1 ? '' : 's'}${wanted ? ` to "${receiver!.trim()}"` : ''}, ${open} open) — list the lines; ask by the lettered ref (e.g. ${base}${options[0] ?? 'A'}) for one option's full detail.`,
      sends: sends.map((s) => ({
        tab: s.tab, id: s.id, ref: s.ref, option_letter: s.option_letter, receiver: s.receiver, status: s.status, date_on: s.date_on,
        consignment_number: s.consignment_number, courier: s.courier_norm, awb: s.awb, open: isOpenSend(s),
        line: describeOption(base, s),
      })),
    };
  }
}
