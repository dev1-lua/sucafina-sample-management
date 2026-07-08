import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { normalizeAwb } from '../../lib/normalize';

export default class TrackAwbTool implements LuaTool {
  name = 'track_awb';
  description = 'Courier tracking status for an AWB/tracking number, looked up across all three tables (prototype: simulated data).';

  inputSchema = z.object({
    awb: z.string().describe('AWB / tracking number'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    // Stored AWBs are digits-only text; normalize the same way so a pasted/spaced
    // number still matches (data-dictionary §9 rule 1).
    const awb = normalizeAwb(input.awb) ?? input.awb;
    return apiFetch(`/tracking/${encodeURIComponent(awb)}`);
  }
}
