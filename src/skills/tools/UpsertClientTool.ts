import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';

export default class UpsertClientTool implements LuaTool {
  name = 'upsert_client';
  description = 'Add a new client or add a contact/address to an existing one.';

  inputSchema = z.object({
    name: z.string().describe('Company name'),
    country: z.string().optional(),
    attention_to: z.string().optional().describe('Contact person'),
    full_address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const contact = input.attention_to || input.full_address || input.phone || input.email
      ? { attention_to: input.attention_to, full_address: input.full_address, phone: input.phone, email: input.email }
      : null;
    const client = await apiFetch('/clients', {
      method: 'POST',
      body: JSON.stringify({ name: input.name, country: input.country ?? null, contact }),
    });
    return { tab: 'clients', ...client, url: dashboardUrl('clients', client.id, 'updated') };
  }
}
