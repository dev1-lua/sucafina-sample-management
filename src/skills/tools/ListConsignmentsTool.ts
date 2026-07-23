import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { normalizeLocation } from '../../lib/normalize';

export default class ListConsignmentsTool implements LuaTool {
  name = 'list_consignments';
  description = 'List consignments with their member counts, newest first. Optionally filter by lab location or status.';

  inputSchema = z.object({
    location: z.string().optional().describe('Filter by lab — "Westlands" or "Thika".'),
    status: z.enum(['open', 'dispatched', 'closed']).optional(),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const params = new URLSearchParams();
    const loc = normalizeLocation(input.location);
    if (loc) params.set('location', loc);
    if (input.status) params.set('status', input.status);
    const res = await apiFetch(`/consignments${params.toString() ? `?${params}` : ''}`);
    return {
      total: res.total,
      consignments: (res.data ?? []).map((c: Record<string, unknown>) => ({
        number: c.number,
        location: c.location,
        status: c.status,
        member_count: c.member_count,
        notes: c.notes,
      })),
    };
  }
}
