import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { TABS } from '../../lib/normalize';

export default class GetSampleStatsTool implements LuaTool {
  name = 'get_sample_stats';
  description =
    'Counts and breakdowns across all books — totals by status, book (tab), sample type, result, courier, and country, plus scalars (in transit, awaiting results, aging >7d, dispatched this week) and monthly volume. Use for "how many …", "give me a breakdown", or dashboard-style questions instead of listing rows. Optional filters narrow every count at once.';

  inputSchema = z.object({
    tab: z.enum(TABS).optional().describe('Restrict counts to one book'),
    status: z.string().optional().describe('Comma list: requested,preparing,dispatched,delivered,results_in,cancelled'),
    sample_type: z.string().optional().describe('e.g. offer, pss, type'),
    country: z.string().optional(),
    courier: z.string().optional(),
    result: z.string().optional().describe('approved, rejected, pending_feedback'),
    month: z.string().optional().describe('YYYY-MM'),
    quality: z.string().optional().describe('Text match on the coffee/quality title'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(input)) {
      if (v == null || v === '') continue;
      // `quality` here is a substring match; on the wire it's `quality_like` (the plain `quality`
      // param is the dashboard's exact multi-select). See api/src/routes/stats.ts.
      p.set(k === 'quality' ? 'quality_like' : k, String(v));
    }
    const s = await apiFetch(`/stats${p.toString() ? `?${p}` : ''}`);
    return {
      by_status: s.by_status,
      by_tab: s.by_tab,
      by_sample_type: s.by_sample_type,
      by_result: s.by_result,
      by_courier: s.by_courier,
      by_country: s.by_country,
      volume_over_time: s.volume_over_time,
      in_transit: s.in_transit,
      awaiting_results: s.awaiting_results,
      awaiting_results_aging: s.awaiting_results_aging,
      dispatched_this_week: s.dispatched_this_week,
    };
  }
}
