import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class GetClientTool implements LuaTool {
  name = 'get_client';
  description =
    "Get a client's full book entry: contacts (attention_to, full_address, phone, email), account owner, and recent order history. Use whenever asked for a client's address / contact / who owns them / what they've ordered. Pass client_id from find_client, OR a name and it resolves the single match (returns the candidate list if the name is ambiguous).";

  inputSchema = z.object({
    client_id: z.string().optional().describe('Client id from find_client (preferred).'),
    query: z.string().optional().describe('Company name, if you have no id — resolves to the single matching client.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    let id = input.client_id;
    if (!id) {
      if (!input.query) return { found: false, message: 'Provide a client_id or a company name to look up.' };
      const res = await apiFetch(`/clients?q=${encodeURIComponent(input.query)}&pageSize=100`);
      if (!res.data.length) return { found: false, message: `No client matching "${input.query}" in the book yet.` };
      if (res.data.length > 1) {
        return {
          found: false,
          ambiguous: true,
          message: `Multiple clients match "${input.query}" — confirm which one.`,
          matches: res.data.map((c: any) => ({ id: c.id, name: c.name, country: c.country })),
        };
      }
      id = res.data[0].id;
    }

    const c = await apiFetch(`/clients/${encodeURIComponent(id)}`);
    const orders = Array.isArray(c.orders) ? c.orders : [];
    return {
      found: true,
      id: c.id,
      name: c.name,
      country: c.country,
      contacts: (c.contacts ?? []).map((ct: any) => ({
        attention_to: ct.attention_to,
        full_address: ct.full_address,
        phone: ct.phone,
        email: ct.email,
      })),
      account_owner: c.account_owner
        ? { name: c.account_owner.name, role: c.account_owner.role, email: c.account_owner.email }
        : null,
      // Client specs (migration 009) — the desk's guide when sending samples. Null when unset.
      specs: {
        grades: c.spec_grades ?? null,
        cup_profile: c.spec_cup_profile ?? null,
        moisture_max: c.spec_moisture_max ?? null,
        min_score: c.spec_min_score ?? null,
        notes: c.spec_notes ?? null,
      },
      // Server caps the embedded order list at 200; flag when it's likely truncated.
      orders_shown: orders.length,
      orders_capped: orders.length >= 200,
      recent_orders: orders.slice(0, 10).map((o: any) => ({
        tab: o.tab,
        ref: o.ref,
        title: o.title,
        status: o.status,
        date: o.date_on,
        awb: o.awb,
        result: o.result_norm,
      })),
    };
  }
}
