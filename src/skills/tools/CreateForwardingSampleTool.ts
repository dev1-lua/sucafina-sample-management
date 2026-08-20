import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
import { normalizeAwb, normalizeCountry, normalizeCourier, normalizeLocation } from '../../lib/normalize';
import { currentUserName } from '../../lib/current-user';
import { assertDeliverable } from '../../lib/client-guard';

export default class CreateForwardingSampleTool implements LuaTool {
  name = 'create_forwarding_sample';
  description =
    'Create one Forwarding-book row (one row per per-bag ID Number under a single AWB). Hard-requires sender, origin, sample ref, coffee quality, receiver, and the bag ID Number — the API rejects an incomplete record. For a multi-parcel shipment, call this once per ID Number. REFUSES to write when the receiver is not in the client book or has no delivery address on file (internal Sucafina offices exempt) — the error tells you what to ask for and to save it via upsert_client first.';

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
    requested_by: z.string().optional().describe('Sales Trader who wants this sample sent, e.g. "Muki" — pass it when someone logs on a trader\'s behalf ("Muki wants…", "for Ivo"). Defaults to the chatting user when they are the trader.'),
    stock_grams: z.number().int().optional().describe('Grams of this lot the lab still holds in stock, when stated.'),
    priority: z
      .enum(['normal', 'urgent'])
      .optional()
      .describe('Urgency flag. Set "urgent" when the trader says urgent / ASAP / rush; defaults to normal.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const courier = normalizeCourier(input.courier);
    const awb = normalizeAwb(input.awb);
    const origin = normalizeCountry(input.origin) ?? input.origin;
    const location = normalizeLocation(input.location);
    // Logged by = the chatting user, always auto-stamped (never a model input);
    // requested_by = the Sales Trader, defaulting to the same person when they log their own ask.
    const loggedBy = await currentUserName();
    const requestedBy = input.requested_by ?? loggedBy;
    // Delivery-address gate: the receiver must be in the book with an address (internal offices exempt).
    const deliverable = await assertDeliverable({ client_id: input.client_id, name: input.receiver_company });
    const clientId = input.client_id ?? deliverable.client_id;

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
        client_id: clientId ?? null,
        phyto_cert: input.phyto_cert ?? null,
        location: location ?? null,
        requested_by: requestedBy ?? null,
        logged_by: loggedBy ?? null,
        stock_grams: input.stock_grams ?? null,
        priority: input.priority ?? null,
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
      requested_by: row.requested_by,
      logged_by: row.logged_by,
      stock_grams: row.stock_grams,
      priority: row.priority,
      url: dashboardUrl('forwarding', row.id, 'created'),
    };
  }
}
