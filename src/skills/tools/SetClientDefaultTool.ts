import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';

export default class SetClientDefaultTool implements LuaTool {
  name = 'set_client_default';
  description =
    "Remember a per-client default on the client book — currently the phyto-cert answer. Once set, every new sample for that client gets it automatically and the phyto question is skipped. Use when the trader says e.g. \"Paulig always needs a phyto\" or answers the phyto question for a known client.";

  inputSchema = z.object({
    client_id: z.string().describe('Client id from find_client / get_client.'),
    default_phyto_cert: z
      .string()
      .describe('The standing phyto answer for this client — "Yes", "No", or "Client to confirm".'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const client = await apiFetch(`/clients/${encodeURIComponent(input.client_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ default_phyto_cert: input.default_phyto_cert }),
    });
    return {
      tab: 'clients',
      id: client.id,
      name: client.name,
      default_phyto_cert: client.default_phyto_cert,
      url: dashboardUrl('clients', client.id, 'updated'),
    };
  }
}
