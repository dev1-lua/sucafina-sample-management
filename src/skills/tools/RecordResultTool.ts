import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
import { TAB_ENDPOINT } from '../../lib/normalize';

const RESULT_TABS = ['specialty', 'bulk'] as const; // Forwarding has no results/cupping step

export default class RecordResultTool implements LuaTool {
  name = 'record_result';
  description =
    'Record the cupping/client outcome for a Specialty or Commercial sample (approved/rejected/pending_feedback + notes). Forwarding has no result field — do not call this for a forwarding row.';

  inputSchema = z.object({
    tab: z.enum(RESULT_TABS).describe("'specialty' or 'bulk' (the Commercial book's internal key) only — resolve via search_samples first."),
    id: z.string().describe('Sample row id (resolve via search_samples / get_sample_status first)'),
    result: z.enum(['approved', 'rejected', 'pending_feedback']),
    comments: z.string().optional().describe('Tasting notes / verdict text, verbatim, e.g. "83p, citrus driven, clean"'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const row = await apiFetch(`/${TAB_ENDPOINT[input.tab]}/${input.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ result_norm: input.result, comments: input.comments ?? null }),
    });
    return {
      tab: input.tab,
      id: row.id,
      ref: row.ref ?? row.sample_ref,
      status: row.status,
      result: row.result_norm,
      comments: row.comments,
      url: dashboardUrl(input.tab, row.id, 'updated'),
    };
  }
}
