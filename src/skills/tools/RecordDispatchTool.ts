import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
import { normalizeAwb, normalizeCourier, TABS, TAB_ENDPOINT } from '../../lib/normalize';

const item = z.object({
  tab: z.enum(TABS).describe('Which table the sample lives in (from find_open_samples / search_samples).'),
  id: z.string().describe('Sample row id'),
});

export default class RecordDispatchTool implements LuaTool {
  name = 'record_dispatch';
  description =
    'Mark one or more samples as dispatched with courier + AWB, across specialty, bulk, and forwarding. One AWB can cover several rows (e.g. a batch of Type samples, or several Forwarding parcels) — pass every {tab, id} in one call.';

  inputSchema = z.object({
    items: z.array(item).min(1).describe('Rows to mark dispatched, each tagged with its table.'),
    courier: z.string().optional().describe('Courier as stated, e.g. DHL, Fedex, Kiptoo, HD, picked by client.'),
    awb: z.string().optional().describe('AWB/tracking number if there is one; normalized to digits-only.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const courier = normalizeCourier(input.courier);
    const awb = normalizeAwb(input.awb);
    const updated = [];
    for (const it of input.items) {
      const row = await apiFetch(`/${TAB_ENDPOINT[it.tab]}/${it.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'dispatched', courier_norm: courier ?? null, awb: awb ?? null }),
      });
      updated.push({
        tab: it.tab,
        id: row.id,
        ref: row.ref ?? row.sample_ref,
        status: row.status,
        courier: row.courier_norm,
        awb: row.awb,
        url: dashboardUrl(it.tab, row.id, 'updated'),
      });
    }
    return { updated };
  }
}
