import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
import { normalizeAwb, normalizeCourier, TABS, TAB_ENDPOINT } from '../../lib/normalize';
import { currentUserName } from '../../lib/current-user';
import { apiFetch as api } from '../../lib/api';
import { isInternalOffice } from '../../lib/client-guard';

const item = z.object({
  tab: z.enum(TABS).describe('Which table the sample lives in (from find_open_samples / search_samples).'),
  id: z.string().describe('Sample row id'),
});

export default class RecordDispatchTool implements LuaTool {
  name = 'record_dispatch';
  description =
    'Mark one or more samples as dispatched with courier + AWB, across specialty, commercial, and forwarding. One AWB can cover several rows (e.g. a batch of Type samples, or several Forwarding parcels) — pass every {tab, id} in one call.';

  inputSchema = z.object({
    items: z.array(item).min(1).describe('Rows to mark dispatched, each tagged with its table.'),
    courier: z.string().optional().describe('Courier as stated, e.g. DHL, Fedex, Kiptoo, HD, picked by client.'),
    awb: z.string().optional().describe('AWB/tracking number if there is one; normalized to digits-only.'),
    phyto_cert: z
      .string()
      .optional()
      .describe('Whether the shipment needs a phytosanitary certificate — "Yes", "No", or "Client to confirm". Applies to every row in the call (one shipment, one answer).'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const courier = normalizeCourier(input.courier);
    const awb = normalizeAwb(input.awb);
    // Who completed the request (Muki): the human running the dispatch chat.
    const completedBy = await currentUserName();
    const updated = [];
    const addressCache = new Map<string, { missing: boolean; asked: string | null; askedAt: string | null }>();
    for (const it of input.items) {
      const row = await apiFetch(`/${TAB_ENDPOINT[it.tab]}/${it.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'dispatched',
          courier_norm: courier ?? null,
          awb: awb ?? null,
          phyto_cert: input.phyto_cert ?? null,
          completed_by: completedBy ?? null,
        }),
      });
      // Delivery-address check (does not block — the parcel has already gone): flag rows whose client
      // book entry has no street address so the desk fixes the book before the next send.
      let gap = { missing: false, asked: null as string | null, askedAt: null as string | null };
      if (row.client_id) {
        if (!addressCache.has(row.client_id)) {
          try {
            const c = await api(`/clients/${encodeURIComponent(row.client_id)}`);
            const missing = !isInternalOffice(c.name) && c.address_missing === true;
            addressCache.set(row.client_id, {
              missing,
              asked: missing ? (c.detail_request?.asked_name ?? c.detail_request?.asked_email ?? null) : null,
              askedAt: missing ? (c.detail_request?.asked_at ?? null) : null,
            });
          } catch {
            addressCache.set(row.client_id, { missing: false, asked: null, askedAt: null });
          }
        }
        gap = addressCache.get(row.client_id)!;
      }
      updated.push({
        tab: it.tab,
        id: row.id,
        ref: row.ref ?? row.sample_ref,
        status: row.status,
        priority: row.priority,
        client_address_missing: gap.missing,
        details_requested_from: gap.asked,
        details_requested_at: gap.askedAt,
        courier: row.courier_norm,
        awb: row.awb,
        phyto_cert: row.phyto_cert,
        completed_by: row.completed_by,
        // Grams left after the dispatch decrement — lets the agent flag depleted lots.
        stock_grams: row.stock_grams,
        url: dashboardUrl(it.tab, row.id, 'updated'),
      });
    }
    return { updated };
  }
}
