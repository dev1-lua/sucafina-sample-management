import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { consignmentUrl } from '../../lib/links';
import { TABS } from '../../lib/normalize';
import { resolveConsignment, resolveSamples, attachSamples } from './_consignment';

const member = z.object({
  tab: z.enum(TABS).describe("The sample's book key — 'specialty' | 'bulk' (Commercial) | 'forwarding'."),
  id: z.string().describe('Sample row id.'),
});

export default class AddSamplesToConsignmentTool implements LuaTool {
  name = 'add_samples_to_consignment';
  description =
    'Add existing samples to an order / consignment — as {tab, id} (from a create or search result) or by ref (a ref names the coffee and may have several sends: pass receiver to pick one; an ambiguous ref comes back in unresolved with the reason).';

  inputSchema = z
    .object({
      consignment: z.string().describe('The consignment number (e.g. "CN-1000") or its id.'),
      samples: z.array(member).optional().describe('Sends to add, as {tab, id}.'),
      refs: z.array(z.string()).optional().describe('Refs of the samples to add, e.g. ["SL-8000", "TYPE-980"].'),
      receiver: z.string().optional().describe('Receiver / client name to pick the right send when a ref has several.'),
    })
    .refine((v) => (v.samples?.length ?? 0) + (v.refs?.length ?? 0) > 0, { message: 'Pass samples [{tab, id}] or refs [].' });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const c = await resolveConsignment(input.consignment);
    if (!c) return { found: false, message: `No consignment matching "${input.consignment}"` };
    const samples = [...(input.samples ?? [])];
    let missing: Array<{ ref: string; reason: string }> = [];
    if (input.refs?.length) {
      const resolved = await resolveSamples(input.refs, { receiver: input.receiver });
      samples.push(...resolved.found.map((s) => ({ tab: s.tab, id: s.id })));
      missing = resolved.missing;
    }
    const added = samples.length ? await attachSamples(c.id, samples) : 0;
    return {
      consignment: c.number,
      added,
      unresolved_refs: missing.map((m) => m.ref),
      ...(missing.length ? { unresolved: missing } : {}),
      url: consignmentUrl(c.id, 'updated'),
    };
  }
}
