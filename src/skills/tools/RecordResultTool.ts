import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class RecordResultTool implements LuaTool {
  name = 'record_result';
  description = 'Record the cupping/client outcome for a sample (approved/rejected + notes).';

  inputSchema = z.object({
    sample_id: z.string().describe('Sample id (resolve via search_samples / get_sample_status first)'),
    result: z.enum(['approved', 'rejected', 'pending_feedback']),
    cupping_notes: z.string().optional().describe('e.g. "83p, citrus driven, clean"'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const row = await apiFetch(`/samples/${input.sample_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ result: input.result, cupping_notes: input.cupping_notes ?? null }),
    });
    return { ref: row.ref ?? row.ref_raw, status: row.status, result: row.result, cupping_notes: row.cupping_notes };
  }
}
