import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
import { currentUserName } from '../../lib/current-user';
import { checkDeliverable, lastPssQty } from '../../lib/client-guard';
import { notifyContactGap, touchRoster } from '../../lib/notify';
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

export default class CreateBulkSampleTool implements LuaTool {
  name = 'create_bulk_sample';
  description =
    'Create one Commercial-book sample record (offer/type/PSS sample tied to an external client + country; the book formerly called "Bulk"). Hard-requires quality, sample type, and client — the API rejects an incomplete record. Never blocked by client details: an unknown client is added to the book from its name (client_created) and the result lists client_details_missing (street address / country — route them with request_missing_details) and client_details_optional (contact person / phone / email). Returns the row (Commercial refs are not auto-issued — pass one if the trader gave it).';

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
    sample_ref: z.string().optional().describe('Sample ref if stated, e.g. "TYPE - 980", "SSKE-104933" (not auto-issued for Commercial).'),
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
      .describe('Quantity in grams; defaults by sample type if omitted (offer 200, type 300). A PSS defaults to the client\'s last PSS size; when there is none the result says qty_to_confirm and you ask once.'),
    moisture_pct: z.number().optional().describe('Green moisture %, if given by the lab.'),
    water_activity_num: z.number().optional().describe('Water activity (aw), if given by the lab.'),
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
    const country = normalizeCountry(input.country);
    let qtyGrams = input.qty_grams ?? DEFAULT_QTY_GRAMS[sampleType];
    const pssNote = sampleType === 'pss' ? extractPssNote(input.sample_type) : undefined;
    const comments = [input.comments, pssNote].filter(Boolean).join(' — ') || undefined;
    // For a PSS, derive the shipment month from the type string ("PSS June Shipment") if not given.
    const shipmentMonth = input.shipment_month ?? (sampleType === 'pss' ? extractShipmentMonth(input.sample_type) : undefined);
    const location = normalizeLocation(input.location);
    // Logged by = the chatting user, always auto-stamped (never a model input);
    // requested_by = the Sales Trader, defaulting to the same person when they log their own ask.
    const loggedBy = await currentUserName();
    const requestedBy = input.requested_by ?? loggedBy;
    // Log first, complete later: resolve (or add) the client and REPORT the book's gaps; never block.
    const deliverable = await checkDeliverable({ client_id: input.client_id, name: input.client, country, requireCountry: true });
    void touchRoster();
    const clientId = input.client_id ?? deliverable.client_id;
    // A PSS with no size given takes the client's usual (their last PSS in the Commercial book) — never a
    // fixed 1 kg. With no history either, the row is written without a qty and the model asks once.
    let qtySource: 'given' | 'default' | 'client_usual' | 'none' = input.qty_grams != null ? 'given' : qtyGrams != null ? 'default' : 'none';
    if (qtyGrams == null && sampleType === 'pss') {
      const usual = await lastPssQty(clientId);
      if (usual != null) { qtyGrams = usual; qtySource = 'client_usual'; }
    }
    // Backfill the client's country from the destination when the book had none (never overwrites).
    if (deliverable.client && !deliverable.client.country && country) {
      await apiFetch('/clients', { method: 'POST', body: JSON.stringify({ name: deliverable.client.name, country }) }).catch(() => undefined);
    }

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

    // Present only when the client has no account manager with an email on file AND the Sales Trader
    // is not reachable on the roster either (they are always in the loop, lifecycle sketch 2026-09-14) — the
    // intake skill's KEEP IN THE LOOP step keys off this field (feedback #34).
    const gap = await notifyContactGap(row.client_id, { coveredBy: [requestedBy] });

    return {
      ...(gap ? { notify_contact_gap: gap } : {}),
      client_id: clientId ?? null,
      client_created: deliverable.client_created,
      client_details_missing: deliverable.details_missing,
      qty_source: qtySource,
      ...(sampleType === 'pss' && qtySource === 'none' ? { qty_to_confirm: true, qty_hint: 'Ask once how many grams per PSS option this client takes (e.g. Nespresso 1 kg, Zoegas 600 g, JDE 300 g, CK 500 g), then update_sample_status with qty_grams.' } : {}),
      client_details_optional: deliverable.details_optional,
      client_url: clientId ? dashboardUrl('clients', clientId, deliverable.client_created ? 'created' : 'updated') : null,
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
      phyto_cert: row.phyto_cert,
      blend: row.blend,
      shipment_month: row.shipment_month,
      contract_number: row.contract_number,
      location: row.location,
      requested_by: row.requested_by,
      logged_by: row.logged_by,
      stock_grams: row.stock_grams,
      priority: row.priority,
      url: dashboardUrl('bulk', row.id, 'created'),
    };
  }
}
