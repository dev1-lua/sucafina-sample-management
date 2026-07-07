import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class RecordDispatchTool implements LuaTool {
  name = 'record_dispatch';
  description = 'Mark samples as dispatched with courier and AWB/tracking number.';

  inputSchema = z.object({
    sample_ids: z.array(z.string()).min(1).describe('Sample ids from find_open_samples'),
    courier: z.enum(['dhl', 'fedex', 'ups', 'rider', 'hand_delivery', 'client_pickup', 'other']),
    awb: z.string().optional().describe('Tracking/AWB number if there is one'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const updated = [];
    for (const id of input.sample_ids) {
      const row = await apiFetch(`/samples/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'dispatched', courier: input.courier, awb: input.awb ?? null }),
      });
      updated.push({ ref: row.ref ?? row.ref_raw, status: row.status, awb: row.awb });
    }
    return { updated };
  }
}
