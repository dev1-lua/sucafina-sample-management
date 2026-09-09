import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { normalizeAwb } from '../../lib/normalize';

export default class TrackAwbTool implements LuaTool {
  name = 'track_awb';
  description = 'Live courier tracking (DHL / FedEx) for an AWB: status, last scan, location, ETA or delivered date, checked_at, plus the sample rows carrying that AWB. Other couriers return status unknown.';

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
