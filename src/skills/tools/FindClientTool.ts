import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { isInternalOffice } from '../../lib/client-guard';

export default class FindClientTool implements LuaTool {
  name = 'find_client';
  description =
    'Search the client address book by (partial) company name. Returns up to 100 matches with ids, `contact_count`, `latest_order_date` and `address_missing` (true = no delivery address on file yet — ask for it in the one-line intake question BEFORE logging) per match, plus `total` (true match count). For the actual address / contacts / order history, call get_client with the id. `total: 0` means the company is not in the client book yet — offer to add it, don\'t claim it doesn\'t exist elsewhere.';

  inputSchema = z.object({
    query: z.string().describe('Partial or full client/company name, e.g. "beyers"'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const res = await apiFetch(`/clients?q=${encodeURIComponent(input.query)}&pageSize=100`);
    return {
      total: res.total,
      matches: res.data.map((c: any) => ({
        id: c.id,
        name: c.name,
        country: c.country,
        contact_count: c.contact_count,
        latest_order_date: c.latest_order_date,
        // Internal offices (Sucafina/Kenyacof) never need an address — the desk knows where they are.
        address_missing: c.address_missing === true && !isInternalOffice(c.name),
      })),
    };
  }
}
