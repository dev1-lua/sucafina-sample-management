import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
import { clientGaps, getClient, isInternalOffice } from '../../lib/client-guard';

export default class UpsertClientTool implements LuaTool {
  name = 'upsert_client';
  description =
    'Add a client from its name alone, or add/complete a contact + delivery address on an existing one (matching contact rows are merged, not duplicated). Never refuses for missing details: the result lists missing_details (street address / country — the lab cannot ship without these; saving the address closes any open ask) and optional_missing (contact person / phone / email). Internal Sucafina/Kenyacof offices never have gaps. Returns the client id to pass as client_id on create calls.';

  inputSchema = z.object({
    name: z.string().describe('Company name'),
    country: z.string().optional().describe("Client's country, e.g. \"Finland\", \"USA\"."),
    attention_to: z.string().optional().describe('Contact person'),
    full_address: z.string().optional().describe('Full street delivery address (street, city, postcode).'),
    phone: z.string().optional().describe("Contact's phone number (the courier needs it)."),
    email: z.string().optional().describe("The CLIENT's contact email (dispatch confirmations + feedback chasers go here). Never a Sucafina colleague — those go through save_notify_contact."),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const name = input.name.trim();
    const internal = isInternalOffice(name);
    const contact = input.attention_to || input.full_address || input.phone || input.email
      ? { attention_to: input.attention_to, full_address: input.full_address, phone: input.phone, email: input.email }
      : null;
    // POST /clients upserts by name: an existing company gets the contact merged (and a country backfilled).
    const client = await apiFetch('/clients', {
      method: 'POST',
      body: JSON.stringify({ name, country: input.country ?? null, contact }),
    });
    const full = await getClient(client.id);
    const gaps = clientGaps(full);
    const addressOnFile = internal || gaps.missing.length === 0;
    return {
      tab: 'clients',
      id: full.id,
      name: full.name,
      country: full.country,
      internal_office: internal,
      contacts: full.contacts,
      delivery_address_on_file: addressOnFile,
      missing_details: gaps.missing,
      optional_missing: gaps.optional,
      url: dashboardUrl('clients', full.id, 'updated'),
    };
  }
}
