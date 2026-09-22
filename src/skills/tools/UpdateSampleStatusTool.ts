import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
import { TABS, TAB_ENDPOINT, type Tab } from '../../lib/normalize';
import { resolveSampleByRef } from '../../lib/resolve-sample';

export default class UpdateSampleStatusTool implements LuaTool {
  name = 'set_sample_status';
  description =
    'Mark a sample as being prepared by the lab (status → preparing) — the people in the loop (the Sales Trader, whoever logged it, the client\'s account manager plus anyone added to the sample) are pinged automatically as it progresses. Pass tab + id if you already have them (from search_samples / find_open_samples), or just the ref (e.g. "SL-7007") — a ref names the coffee and may have several sends, so add receiver when the desk said which one. Dispatches stay with record_dispatch; results stay with the results tools. Returns the updated row card fields (+ note when the send had to be picked).';

  inputSchema = z.object({
    // Single-valued on purpose: 'dispatched' belongs to record_dispatch (courier/AWB/stock),
    // 'results_in' to the results tools. This tool exists so QC can say "pulling SL-8007 now".
    status: z.enum(['preparing']).describe('The lab has started preparing the sample.'),
    ref: z.string().optional().describe('Sample ref, e.g. "TYPE-1006", "SSKE-108291", "SL-8007".'),
    receiver: z.string().optional().describe('Receiver / client name to pick the right send when the ref has several, e.g. "TORCH".'),
    tab: z.enum(TABS).optional().describe('Table the sample lives in, when known.'),
    id: z.string().optional().describe('Sample row id, when known.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    let tab: Tab | undefined = input.tab;
    let id = input.id;
    let note: string | undefined;
    if (!id) {
      if (!(input.ref ?? '').trim()) throw new Error('Pass a ref, or tab + id, to identify the sample.');
      const hit = await resolveSampleByRef(input.ref!, { tab, receiver: input.receiver });
      tab = hit.tab;
      id = hit.id;
      note = hit.note;
    }
    if (!tab) throw new Error('tab is required when passing an id.');
    const row = await apiFetch(`/${TAB_ENDPOINT[tab]}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: input.status }),
    });
    return {
      tab,
      id: row.id,
      ref: row.ref ?? row.sample_ref,
      title: row.description ?? row.quality ?? row.coffee_quality,
      receiver: row.receiver_company ?? row.client,
      status: row.status,
      priority: row.priority,
      requested_by: row.requested_by,
      ...(note ? { note } : {}),
      url: dashboardUrl(tab, row.id, 'updated'),
    };
  }
}
