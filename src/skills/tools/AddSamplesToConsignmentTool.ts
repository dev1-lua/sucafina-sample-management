import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { consignmentUrl } from '../../lib/links';
import { resolveConsignment, resolveSamples, attachSamples } from './_consignment';

export default class AddSamplesToConsignmentTool implements LuaTool {
  name = 'add_samples_to_consignment';
  description = 'Group one or more existing samples into a consignment, resolving them by ref/AWB across all three books.';

  inputSchema = z.object({
    consignment: z.string().describe('The consignment number (e.g. "CN-1000") or its id.'),
    sample_refs: z.array(z.string()).min(1).describe('Refs/AWBs of the samples to add, e.g. ["SL-8000", "TYPE-980"].'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const c = await resolveConsignment(input.consignment);
    if (!c) return { found: false, message: `No consignment matching "${input.consignment}"` };
    const resolved = await resolveSamples(input.sample_refs);
    const added = await attachSamples(c.id, resolved.found);
    return {
      consignment: c.number,
      added,
      unresolved_refs: resolved.missing,
      url: consignmentUrl(c.id, 'updated'),
    };
  }
}
