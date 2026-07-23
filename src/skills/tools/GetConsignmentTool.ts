import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { consignmentUrl } from '../../lib/links';
import { resolveConsignment } from './_consignment';

export default class GetConsignmentTool implements LuaTool {
  name = 'get_consignment';
  description = 'Show one consignment — its number, location, status, and the samples grouped into it — resolved by number or id.';

  inputSchema = z.object({
    consignment: z.string().describe('The consignment number (e.g. "CN-1000") or its id.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const c = await resolveConsignment(input.consignment);
    if (!c) return { found: false, message: `No consignment matching "${input.consignment}"` };
    const row = await apiFetch(`/consignments/${c.id}`);
    return {
      number: row.number,
      location: row.location,
      status: row.status,
      notes: row.notes,
      member_count: row.member_count,
      members: (row.members ?? []).map((m: Record<string, unknown>) => ({
        tab: m.tab,
        ref: m.ref,
        title: m.title,
        receiver: m.receiver,
        status: m.status,
      })),
      url: consignmentUrl(c.id, 'updated'),
    };
  }
}
