import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { consignmentUrl, dashboardUrl } from '../../lib/links';
import { normalizeAwb, normalizeCourier, TABS, TAB_ENDPOINT, type Tab } from '../../lib/normalize';
import { currentUserName } from '../../lib/current-user';
import { isInternalOffice } from '../../lib/client-guard';
import { resolveSampleByRef } from '../../lib/resolve-sample';
import { resolveConsignment } from './_consignment';

// Either shape identifies one send: {tab, id} straight from find_open_samples / search_samples, or a ref
// (+ receiver when the coffee has several sends) — resolved through the one resolver, then treated alike.
const byId = z.object({
  tab: z.enum(TABS).describe('Which table the sample lives in (from find_open_samples / search_samples).'),
  id: z.string().describe('Sample row id'),
});
const byRef = z.object({
  ref: z.string().min(1).describe('Sample ref, e.g. "SL-7336" — a ref names the coffee and may have several sends.'),
  receiver: z.string().optional().describe('Receiver / client name to pick the right send when the ref has several.'),
});
const item = z.union([byId, byRef]);

export default class RecordDispatchTool implements LuaTool {
  name = 'record_dispatch';
  description =
    'Mark samples as dispatched with courier + AWB, across specialty, commercial, and forwarding. One AWB can cover several rows (a batch of Type samples, several Forwarding parcels) — pass every item in one call, each as {tab, id} or as {ref, receiver?}. A whole order goes out together: pass consignment "CN-1012" and every live sample in it is dispatched with the same courier + AWB in one go.';

  inputSchema = z
    .object({
      items: z.array(item).min(1).optional().describe('Rows to mark dispatched — {tab, id} or {ref, receiver?} each.'),
      consignment: z.string().optional().describe('Order / consignment number (e.g. "CN-1012") or id — dispatches every live sample in it.'),
      courier: z.string().optional().describe('Courier as stated, e.g. DHL, Fedex, Kiptoo, HD, picked by client.'),
      awb: z.string().optional().describe('AWB/tracking number if there is one; normalized to digits-only.'),
      dispatched_on: z.string().optional().describe('Dispatch date YYYY-MM-DD when it is not today (consignment dispatch only).'),
      phyto_cert: z
        .string()
        .optional()
        .describe('Whether the shipment needs a phytosanitary certificate — "Yes", "No", or "Client to confirm". Applies to every row in the call (one shipment, one answer).'),
    })
    .refine((v) => (v.items?.length ?? 0) > 0 || !!v.consignment?.trim(), { message: 'Pass items (rows to dispatch) or a consignment number.' });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const courier = normalizeCourier(input.courier);
    const awb = normalizeAwb(input.awb);

    // Whole order: one write on the API applies the same dispatch to every live member (contracts §6).
    let order: { consignment: string; updated: number; url: string } | null = null;
    if (input.consignment?.trim()) {
      const c = await resolveConsignment(input.consignment.trim());
      if (!c) return { found: false, message: `No consignment matching "${input.consignment}"` };
      const res = await apiFetch(`/consignments/${c.id}/dispatch`, {
        method: 'POST',
        body: JSON.stringify({ courier: courier ?? null, awb: awb ?? null, ...(input.dispatched_on ? { dispatched_on: input.dispatched_on } : {}) }),
      });
      order = { consignment: c.number, updated: Number(res?.updated ?? 0), url: consignmentUrl(c.id, 'updated') };
      if (!input.items?.length) return order;
    }

    // Who completed the request (Muki): the human running the dispatch chat.
    const completedBy = await currentUserName();
    const updated = [];
    const addressCache = new Map<string, { missing: boolean; asked: string | null; askedAt: string | null }>();
    for (const it of input.items ?? []) {
      let tab: Tab;
      let id: string;
      let note: string | undefined;
      if ('id' in it) {
        tab = it.tab;
        id = it.id;
      } else {
        const hit = await resolveSampleByRef(it.ref, { receiver: it.receiver });
        tab = hit.tab;
        id = hit.id;
        note = hit.note;
      }
      const row = await apiFetch(`/${TAB_ENDPOINT[tab]}/${id}`, {
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
            const c = await apiFetch(`/clients/${encodeURIComponent(row.client_id)}`);
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
        tab,
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
        ...(note ? { note } : {}),
        url: dashboardUrl(tab, row.id, 'updated'),
      });
    }
    // Both given: the order's count and link ride under their own keys, `updated` stays the per-row list.
    return { ...(order ? { consignment: order.consignment, consignment_updated: order.updated, consignment_url: order.url } : {}), updated };
  }
}
