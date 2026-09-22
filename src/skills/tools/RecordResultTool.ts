import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
import { TAB_ENDPOINT } from '../../lib/normalize';
import { resolveSampleByRef } from '../../lib/resolve-sample';

const RESULT_TABS = ['specialty', 'bulk'] as const; // Forwarding has no results/cupping step
type ResultTab = (typeof RESULT_TABS)[number];

export default class RecordResultTool implements LuaTool {
  name = 'record_result';
  description =
    'Record the cupping/client outcome for a Specialty or Commercial sample (approved/rejected/pending_feedback + notes). Identify the send by tab + id (from search_samples) or by ref (+ receiver when the coffee has several sends). Forwarding has no result field — do not call this for a forwarding row.';

  inputSchema = z
    .object({
      tab: z.enum(RESULT_TABS).optional().describe("'specialty' or 'bulk' (the Commercial book's internal key) — with id."),
      id: z.string().optional().describe('Sample row id (from search_samples / get_sample_status) — with tab.'),
      ref: z.string().optional().describe('Sample ref, e.g. "SSKE-104929" — alternative to tab + id.'),
      receiver: z.string().optional().describe('Receiver / client name to pick the right send when the ref has several.'),
      result: z.enum(['approved', 'rejected', 'pending_feedback']),
      comments: z.string().optional().describe('Tasting notes / verdict text, verbatim, e.g. "83p, citrus driven, clean"'),
      rejection_reason: z
        .string()
        .optional()
        .describe('Why it was rejected, e.g. "moldy, inconsistent cup", "quakers". Only meaningful when result is "rejected".'),
    })
    .refine((v) => (v.tab && v.id) || v.ref?.trim(), { message: 'Pass tab + id, or a ref.' });

  async execute(input: z.infer<typeof this.inputSchema>) {
    let tab = input.tab as ResultTab | undefined;
    let id = input.id;
    let note: string | undefined;
    if (!(tab && id)) {
      const hit = await resolveSampleByRef(input.ref!, { receiver: input.receiver });
      if (hit.tab === 'forwarding') {
        return { recorded: false, message: `${hit.ref} is a Forwarding parcel — it has no cupping/result step.` };
      }
      tab = hit.tab;
      id = hit.id;
      note = hit.note;
    }
    // Only attach a rejection reason when the verdict is actually a rejection.
    const rejectionReason = input.result === 'rejected' ? input.rejection_reason ?? null : null;
    const row = await apiFetch(`/${TAB_ENDPOINT[tab]}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ result_norm: input.result, comments: input.comments ?? null, rejection_reason: rejectionReason }),
    });
    return {
      recorded: true,
      tab,
      id: row.id,
      ref: row.ref ?? row.sample_ref,
      status: row.status,
      result: row.result_norm,
      comments: row.comments,
      rejection_reason: row.rejection_reason,
      ...(row.replacement_ref ? { replacement_ref: row.replacement_ref } : {}),
      ...(note ? { note } : {}),
      url: dashboardUrl(tab, row.id, 'updated'),
    };
  }
}
