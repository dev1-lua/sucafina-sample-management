import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
import { normalizeAwb, normalizeCountry, normalizeCourier, normalizeLocation } from '../../lib/normalize';

export default class CreateForwardingSampleTool implements LuaTool {
  name = 'create_forwarding_sample';
  description =
    'Create one Forwarding-book row (one row per per-bag ID Number under a single AWB). Hard-requires sender, origin, sample ref, coffee quality, receiver, and the bag ID Number — the API rejects an incomplete record. For a multi-parcel shipment, call this once per ID Number.';

  inputSchema = z.object({
    sender: z.string().min(1).describe('Who is forwarding the shipment, e.g. "Kenyacof".'),
    origin: z.string().min(1).describe('Origin country of the shipment, e.g. "Uganda" — normalized to Title Case.'),
    sample_ref: z.string().min(1).describe('Sample reference for the shipment, e.g. "SSUG-97043".'),
    coffee_quality: z.string().min(1).describe('Coffee quality, e.g. "Robusta".'),
    receiver_company: z.string().min(1).describe('Who receives it, e.g. "Itochu Japan".'),
    id_number: z.string().min(1).describe('This parcel\'s bag ID Number, e.g. "UGF/25/015" — one row per ID Number.'),
    awb: z.string().optional().describe('AWB/tracking number if already known.'),
    courier: z.string().optional().describe('Courier as stated, e.g. UPS, DHL.'),
    qty: z.string().optional().describe('Quantity as stated, if given.'),
    qty_grams: z.number().int().optional().describe('Quantity in grams, if given.'),
    client_id: z.string().optional().describe('Client id from find_client, when resolved.'),
    phyto_cert: z
      .string()
      .optional()
      .describe('Whether the shipment needs a phytosanitary certificate — "Yes", "No", or "Client to confirm".'),
    location: z.string().optional().describe('Lab the parcel sits at — "Westlands" or "Thika".'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const courier = normalizeCourier(input.courier);
    const awb = normalizeAwb(input.awb);
    const origin = normalizeCountry(input.origin) ?? input.origin;
    const location = normalizeLocation(input.location);

    const row = await apiFetch('/forwarding-samples', {
      method: 'POST',
      body: JSON.stringify({
        sender: input.sender,
        origin,
        sample_ref: input.sample_ref,
        coffee_quality: input.coffee_quality,
        receiver_company: input.receiver_company,
        id_number: input.id_number,
        awb: awb ?? null,
        courier_norm: courier ?? null,
        qty: input.qty ?? null,
        qty_grams: input.qty_grams ?? null,
        client_id: input.client_id ?? null,
        phyto_cert: input.phyto_cert ?? null,
        location: location ?? null,
      }),
    });

    return {
      tab: 'forwarding',
      id: row.id,
      date: row.date,
      sample_ref: row.sample_ref,
      origin: row.origin,
      coffee_quality: row.coffee_quality,
      receiver_company: row.receiver_company,
      id_number: row.id_number,
      status: row.status,
      phyto_cert: row.phyto_cert,
      url: dashboardUrl('forwarding', row.id, 'created'),
    };
  }
}
