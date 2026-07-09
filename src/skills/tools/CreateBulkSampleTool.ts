import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
import {
  DEFAULT_QTY_GRAMS,
  extractPssNote,
  normalizeAwb,
  normalizeCountry,
  normalizeCourier,
  normalizeSampleType,
} from '../../lib/normalize';

export default class CreateBulkSampleTool implements LuaTool {
  name = 'create_bulk_sample';
  description =
    'Create one Bulk-book sample record (commercial/offer/type/PSS sample tied to an external client + country). Hard-requires quality, sample type, and client — the API rejects an incomplete record. Returns the row (Bulk refs are not auto-issued — pass one if the trader gave it).';

  inputSchema = z.object({
    quality: z
      .string()
      .min(1)
      .describe('Full quality description — grade(s) + blend + %, e.g. "AA PLUS (30%), AB (70%) - Sample 1", "AB FAQ".'),
    sample_type: z
      .string()
      .min(1)
      .describe(
        'Sample purpose as stated or inferred: offer, type, pss (may include "PSS June Shipment" or "(replacement)"), woc, retention, flavor_mapping, marketing, calibration, or other.',
      ),
    client: z.string().min(1).describe('External client name (or internal contact), e.g. "Beyers", "Edmax Coffee".'),
    sample_ref: z.string().optional().describe('Sample ref if stated, e.g. "TYPE - 980", "SSKE-104933" (not auto-issued for Bulk).'),
    bags: z.number().int().optional().describe('Bags in the source lot.'),
    client_ref: z.string().optional().describe("Client's own reference number, e.g. a Zoegas/Nestle reference."),
    ico_mark: z.string().optional().describe('International Coffee Org mark, if given.'),
    country: z.string().optional().describe('Destination country, e.g. "Netherlands", "kenya" — normalized to Title Case.'),
    awb: z.string().optional().describe('AWB/tracking number if already known.'),
    courier: z.string().optional().describe('Courier as stated, e.g. DHL, Fedex, Kiptoo, HD.'),
    qty: z.string().optional().describe('Quantity as stated, e.g. "300", "200" (bags/grams per context).'),
    qty_grams: z
      .number()
      .int()
      .optional()
      .describe('Quantity in grams; defaults by sample type if omitted (offer 200, type 300, pss 1000).'),
    moisture_pct: z.number().optional().describe('Green moisture %, if given by the lab.'),
    water_activity_num: z.number().optional().describe('Water activity (aw), if given by the lab.'),
    comments: z.string().optional(),
    crop_year: z.string().optional().describe('Harvest year, e.g. "2025/2026".'),
    client_id: z.string().optional().describe('Client id from find_client, when resolved.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const sampleType = normalizeSampleType(input.sample_type) ?? 'other';
    const courier = normalizeCourier(input.courier);
    const awb = normalizeAwb(input.awb);
    const country = normalizeCountry(input.country);
    const qtyGrams = input.qty_grams ?? DEFAULT_QTY_GRAMS[sampleType];
    const pssNote = sampleType === 'pss' ? extractPssNote(input.sample_type) : undefined;
    const comments = [input.comments, pssNote].filter(Boolean).join(' — ') || undefined;

    const row = await apiFetch('/bulk-samples', {
      method: 'POST',
      body: JSON.stringify({
        quality: input.quality,
        client: input.client,
        sample_type: sampleType,
        sample_ref: input.sample_ref ?? null,
        bags: input.bags ?? null,
        client_ref: input.client_ref ?? null,
        ico_mark: input.ico_mark ?? null,
        country: country ?? null,
        awb: awb ?? null,
        courier_norm: courier ?? null,
        qty: input.qty ?? null,
        qty_grams: qtyGrams ?? null,
        moisture: input.moisture_pct != null ? String(input.moisture_pct) : null,
        water_activity: input.water_activity_num != null ? String(input.water_activity_num) : null,
        moisture_pct: input.moisture_pct ?? null,
        water_activity_num: input.water_activity_num ?? null,
        comments: comments ?? null,
        crop_year: input.crop_year ?? null,
        client_id: input.client_id ?? null,
      }),
    });

    return {
      tab: 'bulk',
      id: row.id,
      date: row.date,
      sample_ref: row.sample_ref,
      quality: row.quality,
      client: row.client,
      country: row.country,
      sample_type: row.sample_type_norm,
      qty_grams: row.qty_grams,
      status: row.status,
      url: dashboardUrl('bulk', row.id, 'created'),
    };
  }
}
