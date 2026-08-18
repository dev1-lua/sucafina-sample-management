import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
import { findClientByName, hasDeliveryAddress, isInternalOffice } from '../../lib/client-guard';

export default class UpsertClientTool implements LuaTool {
  name = 'upsert_client';
  description =
    'Add a new client, or add/complete a contact + delivery address on an existing one (matching contact rows are merged, not duplicated). A NEW external client is REFUSED without country, attention_to (contact person), full_address (street address) and phone — collect them from the trader first. Internal Sucafina/Kenyacof offices can be added with just the name. Returns the client id to pass as client_id on create calls, plus whether a delivery address is now on file.';

  inputSchema = z.object({
    name: z.string().describe('Company name'),
    country: z.string().optional().describe("Client's country, e.g. \"Finland\", \"USA\"."),
    attention_to: z.string().optional().describe('Contact person'),
    full_address: z.string().optional().describe('Full street delivery address (street, city, postcode).'),
    phone: z.string().optional().describe("Contact's phone number (the courier needs it)."),
    email: z.string().optional().describe("Contact's email (dispatch confirmations + feedback chasers go here)."),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const name = input.name.trim();
    const internal = isInternalOffice(name);
    const { client: existing } = await findClientByName(name);

    if (!existing && !internal) {
      const missing: string[] = [];
      if (!input.country?.trim()) missing.push('country');
      if (!input.attention_to?.trim()) missing.push('attention_to (contact person)');
      if (!input.full_address?.trim()) missing.push('full_address (street address)');
      if (!input.phone?.trim()) missing.push('phone');
      if (missing.length) {
        throw new Error(
          `Cannot add new client "${name}" without: ${missing.join(', ')}. Ask the trader for ${missing.length === 1 ? 'it' : 'these'} (one at a time), then call upsert_client again with every field. Do not create a sample for this client until it is in the book with a delivery address.`,
        );
      }
    }

    const contact = input.attention_to || input.full_address || input.phone || input.email
      ? { attention_to: input.attention_to, full_address: input.full_address, phone: input.phone, email: input.email }
      : null;
    const client = await apiFetch('/clients', {
      method: 'POST',
      body: JSON.stringify({ name, country: input.country ?? null, contact }),
    });
    const full = await apiFetch(`/clients/${encodeURIComponent(client.id)}`);
    const contacts = (full.contacts ?? []).map((ct: any) => ({
      attention_to: ct.attention_to,
      full_address: ct.full_address,
      phone: ct.phone,
      email: ct.email,
    }));
    const addressOnFile = internal || hasDeliveryAddress({ contacts });
    return {
      tab: 'clients',
      id: full.id,
      name: full.name,
      country: full.country,
      internal_office: internal,
      contacts,
      delivery_address_on_file: addressOnFile,
      ...(addressOnFile
        ? {}
        : { warning: `${full.name} still has no delivery address — ask for the full street address and save it before logging a sample.` }),
      url: dashboardUrl('clients', full.id, 'updated'),
    };
  }
}
