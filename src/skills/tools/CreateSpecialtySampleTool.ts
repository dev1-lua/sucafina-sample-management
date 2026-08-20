import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
import { currentUserName } from '../../lib/current-user';
import { assertDeliverable } from '../../lib/client-guard';
import {
  DEFAULT_QTY_GRAMS,
  extractPssNote,
  extractShipmentMonth,
  normalizeAwb,
  normalizeCountry,
  normalizeCourier,
  normalizeLocation,
  normalizeSampleType,
} from '../../lib/normalize';

export default class CreateSpecialtySampleTool implements LuaTool {
  name = 'create_specialty_sample';
  description =
    'Create one Specialty-book sample record (single specialty-position lot). Hard-requires description, sample type, receiver, estate/station name, and country of origin. Returns the server-issued ref. REFUSES to write when an external receiver is not in the client book or has no delivery address on file (internal Sucafina offices exempt) — the error tells you what to ask for and to save it via upsert_client first.';

  inputSchema = z.object({
    description: z
      .string()
      .min(1)
      .describe('What is being sent / why, e.g. "AA Sangalai — WOC samples", "AB FAQ retention". This is the coffee/quality text for the row.'),
    sample_type: z
      .string()
      .min(1)
      .describe(
        'Sample purpose as stated or inferred: offer, type, pss (may include "PSS June Shipment" or "(replacement)"), woc, retention, flavor_mapping, marketing, calibration, or other.',
      ),
    receiver_company: z.string().min(1).describe('Who receives it — client or internal office, e.g. "Geneva", "Key Coffee".'),
    ref: z.string().optional().describe('Explicit lot ref like "SL-7346" if stated; omit to let the desk auto-issue one.'),
    outturn: z.string().optional().describe('Milling outturn / warehouse mark, e.g. "17KN0076".'),
    name: z.string().min(1).describe('Estate/station/mark name, e.g. "KABINGARA/KIRINYAGA", "AA Swara". Required — always capture it.'),
    grade: z.string().optional().describe('Screen/quality grade, e.g. AA, AB, PB.'),
    country: z.string().min(1).describe('Origin/destination country for the lot, e.g. "Kenya" — normalized to Title Case. Required — always capture it.'),
    bags: z.number().int().optional().describe('Number of bags in the source lot.'),
    awb: z.string().optional().describe('AWB/tracking number if already known (rare at request time).'),
    courier: z.string().optional().describe('Courier as stated, e.g. DHL, Fedex, Kiptoo, HD.'),
    qty: z.string().optional().describe('Quantity as stated, e.g. "300g", "1kg".'),
    qty_grams: z
      .number()
      .int()
      .optional()
      .describe('Quantity in grams; defaults by sample type if omitted (offer 200, type 300, pss 1000).'),
    comments: z.string().optional(),
    crop_year: z.string().optional().describe('Harvest year, e.g. "2025/2026".'),
    client_id: z.string().optional().describe('Client id from find_client, when resolved.'),
    phyto_cert: z
      .string()
      .optional()
      .describe('Whether the shipment needs a phytosanitary certificate — "Yes", "No", or "Client to confirm".'),
    blend: z.string().optional().describe('Canonical blend composition if this is a blend, e.g. "AA PLUS 30% / AB 70%".'),
    shipment_month: z.string().optional().describe('Shipment month for a PSS/pre-shipment sample, e.g. "June" (auto-derived from a "PSS June Shipment" type if omitted).'),
    contract_number: z.string().optional().describe('Contract number for a PSS/shipment sample, e.g. "CT-2026-14".'),
    location: z.string().optional().describe('Lab the sample sits at — "Westlands" or "Thika".'),
    strategy: z.string().optional().describe('Assigned strategy for this sample, if stated.'),
    highlights: z.string().optional().describe('Cup-profile highlights/tags, e.g. "Blackcurrant bomb, Strict Clean Cups".'),
    requested_by: z.string().optional().describe('Sales Trader who wants this sample sent, e.g. "Muki" — pass it when someone logs on a trader\'s behalf ("Muki wants…", "for Ivo"). Defaults to the chatting user when they are the trader.'),
    stock_grams: z.number().int().optional().describe('Grams of this lot the lab still holds in stock, when stated (e.g. "Westlands has 300g left").'),
    priority: z
      .enum(['normal', 'urgent'])
      .optional()
      .describe('Urgency flag. Set "urgent" when the trader says urgent / ASAP / rush / needs to go today; defaults to normal.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const sampleType = normalizeSampleType(input.sample_type) ?? 'other';
    const courier = normalizeCourier(input.courier);
    const awb = normalizeAwb(input.awb);
    const country = normalizeCountry(input.country) ?? input.country;
    const qtyGrams = input.qty_grams ?? DEFAULT_QTY_GRAMS[sampleType];
    const pssNote = sampleType === 'pss' ? extractPssNote(input.sample_type) : undefined;
    const comments = [input.comments, pssNote].filter(Boolean).join(' — ') || undefined;
    const shipmentMonth = input.shipment_month ?? (sampleType === 'pss' ? extractShipmentMonth(input.sample_type) : undefined);
    const location = normalizeLocation(input.location);
    // Logged by = the chatting user, always auto-stamped (never a model input);
    // requested_by = the Sales Trader, defaulting to the same person when they log their own ask.
    const loggedBy = await currentUserName();
    const requestedBy = input.requested_by ?? loggedBy;
    // Delivery-address gate: an external receiver must be in the book with an address (internal offices exempt).
    const deliverable = await assertDeliverable({ client_id: input.client_id, name: input.receiver_company });
    const clientId = input.client_id ?? deliverable.client_id;

    const row = await apiFetch('/specialty-samples', {
      method: 'POST',
      body: JSON.stringify({
        description: input.description,
        receiver_company: input.receiver_company,
        sample_type_norm: sampleType,
        ref: input.ref ?? null,
        outturn: input.outturn ?? null,
        name: input.name ?? null,
        grade: input.grade ?? null,
        country: country ?? null,
        bags: input.bags ?? null,
        awb: awb ?? null,
        courier_norm: courier ?? null,
        qty: input.qty ?? null,
        qty_grams: qtyGrams ?? null,
        comments: comments ?? null,
        crop_year: input.crop_year ?? null,
        client_id: clientId ?? null,
        phyto_cert: input.phyto_cert ?? null,
        blend: input.blend ?? null,
        shipment_month: shipmentMonth ?? null,
        contract_number: input.contract_number ?? null,
        location: location ?? null,
        strategy: input.strategy ?? null,
        highlights: input.highlights ?? null,
        requested_by: requestedBy ?? null,
        logged_by: loggedBy ?? null,
        stock_grams: input.stock_grams ?? null,
        priority: input.priority ?? null,
      }),
    });

    return {
      tab: 'specialty',
      id: row.id,
      ref: row.ref,
      date: row.date,
      name: row.name,
      description: row.description,
      receiver_company: row.receiver_company,
      sample_type: row.sample_type_norm,
      grade: row.grade,
      country: row.country,
      qty_grams: row.qty_grams,
      status: row.status,
      phyto_cert: row.phyto_cert,
      blend: row.blend,
      shipment_month: row.shipment_month,
      contract_number: row.contract_number,
      location: row.location,
      requested_by: row.requested_by,
      logged_by: row.logged_by,
      stock_grams: row.stock_grams,
      priority: row.priority,
      url: dashboardUrl('specialty', row.id, 'created'),
    };
  }
}
