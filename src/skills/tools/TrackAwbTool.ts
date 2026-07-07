import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class TrackAwbTool implements LuaTool {
  name = 'track_awb';
  description = 'Courier tracking status for an AWB/tracking number (prototype: simulated data).';

  inputSchema = z.object({
    awb: z.string().describe('AWB / tracking number'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    return apiFetch(`/tracking/${encodeURIComponent(input.awb)}`);
  }
}
