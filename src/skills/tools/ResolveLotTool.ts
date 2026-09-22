import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { normalizeRef } from '../../lib/normalize';
import { lotSay, type LotResolution } from '../../lib/lots';

export default class ResolveLotTool implements LuaTool {
  name = 'resolve_lot';
  description =
    'Which ref this coffee gets, BEFORE the create — a ref names the COFFEE (Specialty: outturn + grade; Commercial: quality + blend) and is reused on every send of it. Call once per coffee as soon as its fields are known, with the ref only if the trader typed one in THIS request. Reads only. Returns action reuse (same coffee sent before — the ref comes back, with its earlier sends), new (a fresh ref — the typed one is free, or the desk will issue one) or conflict (the typed ref already names a DIFFERENT coffee — nothing may be written until the trader answers), plus `say`, the line to echo inside the confirm. A PSS ref SSKE-<contract digits><letter> resolves to its contract group (all its lettered options).';

  inputSchema = z.object({
    book: z.enum(['specialty', 'commercial']).describe("Which book the sample goes in: 'specialty' or 'commercial' (the Commercial book, internally 'bulk')."),
    ref: z.string().optional().describe('The ref the trader typed in THIS request, if any (e.g. "TYPE-980", "SL-7336"). Never a ref seen earlier in the chat or on another sample.'),
    outturn: z.string().optional().describe('Specialty: the outturn / warehouse mark, e.g. "17KN0076".'),
    grade: z.string().optional().describe('Specialty: the screen grade, e.g. "AA".'),
    quality: z.string().optional().describe('Commercial: the quality text, e.g. "AB FAQ". Specialty: the description when there is no outturn.'),
    blend: z.string().optional().describe('Commercial: the blend composition when it is a blend, e.g. "AA PLUS 30% / AB 70%".'),
    sample_type: z.string().min(1).describe('Sample purpose as stated: offer, type, pss, woc, retention, flavor_mapping, marketing, calibration, other.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const ref = normalizeRef(input.ref) ?? null;
    const body = {
      book: input.book,
      ref,
      outturn: input.outturn?.trim() || null,
      grade: input.grade?.trim() || null,
      quality: input.quality?.trim() || null,
      blend: input.blend?.trim() || null,
      sample_type: input.sample_type,
    };
    const res = (await apiFetch('/lots/resolve', { method: 'POST', body: JSON.stringify(body) })) as LotResolution;
    const say = lotSay({ ...res, sends: res.sends ?? [] }, { ...body, ref });
    return { ...res, sends: res.sends ?? [], say };
  }
}
