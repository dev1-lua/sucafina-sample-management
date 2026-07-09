import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { TABS, TAB_ENDPOINT } from '../../lib/normalize';

export default class GetSamplesByBookTool implements LuaTool {
  name = 'get_samples_by_book';
  description =
    'List FULL sample rows from ONE book — every column, including the fields search omits: grade/outturn/name/bags (specialty); moisture/water-activity/ICO mark/client-ref (bulk); sender/origin/ID-number (forwarding); plus qty, comments, crop year, sample type, delivery, and the chaser follow-up fields (feedback_requested/received, order_placed, new_sample_requested, new_sample). Use when the user asks about any of those fields or wants to filter/scan within a book. Returns up to 50 full rows per page with the true total + has_more. To filter on a field with no dedicated param (e.g. grade), fetch the narrowed page and read the field off the rows.';

  inputSchema = z.object({
    tab: z.enum(TABS).describe('Which book: specialty, bulk, or forwarding'),
    q: z.string().optional().describe("Free text over that book's ref / quality / receiver / name / awb"),
    status: z.string().optional().describe('Comma list: requested,preparing,dispatched,delivered,results_in,cancelled'),
    sample_type: z.string().optional().describe('specialty/bulk only: offer, type, pss, woc, …'),
    courier: z.string().optional().describe('dhl, fedex, ups, rider, hand_delivery, client_pickup, other'),
    result: z.string().optional().describe('specialty/bulk only: approved, rejected, pending_feedback'),
    country: z.string().optional().describe('specialty/bulk'),
    origin: z.string().optional().describe('forwarding'),
    sender: z.string().optional().describe('forwarding'),
    has_awb: z.boolean().optional(),
    date_from: z.string().optional().describe('YYYY-MM-DD'),
    date_to: z.string().optional().describe('YYYY-MM-DD'),
    moisture_min: z.number().optional().describe('bulk'),
    moisture_max: z.number().optional().describe('bulk'),
    page: z.number().int().min(1).optional().describe('1-based page (50/page)'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const pageSize = 50;
    const page = input.page ?? 1;
    const p = new URLSearchParams({ pageSize: String(pageSize), page: String(page) });
    if (input.q) p.set('q', input.q);
    if (input.status) p.set('status', input.status);
    if (input.sample_type) p.set('sample_type_norm', input.sample_type);
    if (input.courier) p.set('courier_norm', input.courier);
    if (input.result) p.set('result_norm', input.result);
    if (input.country) p.set('country', input.country);
    if (input.origin) p.set('origin', input.origin);
    if (input.sender) p.set('sender', input.sender);
    if (input.has_awb) p.set('has_awb', 'true');
    if (input.date_from) p.set('date_from', input.date_from);
    if (input.date_to) p.set('date_to', input.date_to);
    if (input.moisture_min != null) p.set('moisture_min', String(input.moisture_min));
    if (input.moisture_max != null) p.set('moisture_max', String(input.moisture_max));

    const res = await apiFetch(`/${TAB_ENDPOINT[input.tab]}?${p}`);
    // Full rows, minus the always-null soft-delete marker. Every source + derived + follow-up
    // column of that book comes through (raw `courier` and `courier_norm`, `qty`/`qty_grams`, etc.).
    const samples = (res.data ?? []).map(({ deleted_at, ...row }: any) => row);
    const outPage = res.page ?? page;
    const outSize = res.pageSize ?? pageSize;
    return {
      tab: input.tab,
      total: res.total,
      page: outPage,
      page_size: outSize,
      returned: samples.length,
      has_more: outPage * outSize < res.total,
      samples,
    };
  }
}
