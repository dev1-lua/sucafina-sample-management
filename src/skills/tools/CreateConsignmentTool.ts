import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { consignmentUrl } from '../../lib/links';
import { normalizeLocation } from '../../lib/normalize';
import { resolveSamples, attachSamples } from './_consignment';

export default class CreateConsignmentTool implements LuaTool {
  name = 'create_consignment';
  description =
    'Create a consignment — a group of samples that ship out together — with an auto-generated number (CN-####) and an optional lab location (Westlands/Thika). Optionally group samples into it right away by passing their refs.';

  inputSchema = z.object({
    location: z.string().optional().describe('Lab the consignment ships from / sits at — "Westlands" or "Thika".'),
    notes: z.string().optional().describe('Free-text note, e.g. "September dispatch to Beyers".'),
    sample_refs: z
      .array(z.string())
      .optional()
      .describe('Refs/AWBs of samples to group into this consignment now, e.g. ["SL-8000", "SSKE-104933"].'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const consignment = await apiFetch('/consignments', {
      method: 'POST',
      body: JSON.stringify({ location: normalizeLocation(input.location) ?? null, notes: input.notes ?? null }),
    });

    let added = 0;
    let missing: string[] = [];
    if (input.sample_refs?.length) {
      const resolved = await resolveSamples(input.sample_refs);
      added = await attachSamples(consignment.id, resolved.found);
      missing = resolved.missing;
    }

    return {
      id: consignment.id,
      number: consignment.number,
      location: consignment.location,
      status: consignment.status,
      added,
      unresolved_refs: missing,
      url: consignmentUrl(consignment.id, 'created'),
    };
  }
}
