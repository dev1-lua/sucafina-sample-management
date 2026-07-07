import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class FindClientTool implements LuaTool {
  name = 'find_client';
  description = 'Search the client address book by (partial) company name. Returns matches with ids.';

  inputSchema = z.object({
    query: z.string().describe('Partial or full client/company name, e.g. "beyers"'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const res = await apiFetch(`/clients?q=${encodeURIComponent(input.query)}`);
    return { matches: res.data.map((c: any) => ({ id: c.id, name: c.name, country: c.country })) };
  }
}
