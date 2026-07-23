import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
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
    'Create one Specialty-book sample record (single specialty-position lot). Hard-requires description, sample type, receiver, estate/station name, and country of origin. Returns the server-issued ref.';

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
        client_id: input.client_id ?? null,
        phyto_cert: input.phyto_cert ?? null,
        blend: input.blend ?? null,
        shipment_month: shipmentMonth ?? null,
        contract_number: input.contract_number ?? null,
        location: location ?? null,
        strategy: input.strategy ?? null,
        highlights: input.highlights ?? null,
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
      url: dashboardUrl('specialty', row.id, 'created'),
    };
  }
}
