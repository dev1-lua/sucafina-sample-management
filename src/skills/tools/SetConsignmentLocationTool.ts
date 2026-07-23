import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { consignmentUrl } from '../../lib/links';
import { normalizeLocation } from '../../lib/normalize';
import { resolveConsignment } from './_consignment';

export default class SetConsignmentLocationTool implements LuaTool {
  name = 'set_consignment_location';
  description = 'Assign a consignment to a lab location (Westlands/Thika) and/or update its status (open/dispatched/closed).';

  inputSchema = z.object({
    consignment: z.string().describe('The consignment number (e.g. "CN-1000") or its id.'),
    location: z.string().optional().describe('Lab to assign — "Westlands" or "Thika".'),
    status: z.enum(['open', 'dispatched', 'closed']).optional().describe('Consignment status.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const c = await resolveConsignment(input.consignment);
    if (!c) return { found: false, message: `No consignment matching "${input.consignment}"` };
    const row = await apiFetch(`/consignments/${c.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ location: normalizeLocation(input.location) ?? null, status: input.status ?? null }),
    });
    return {
      consignment: row.number,
      location: row.location,
      status: row.status,
      url: consignmentUrl(c.id, 'updated'),
    };
  }
}
