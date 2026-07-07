import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

const item = z.object({
  quality: z.string().describe('Coffee quality/description, e.g. "AB FAQ", "AA SANGALAI"'),
  sample_type: z.enum(['offer', 'type', 'pss', 'woc', 'retention', 'flavor_mapping', 'marketing', 'calibration', 'other'])
    .describe('Kind of sample'),
  qty_grams: z.number().int().optional().describe('Quantity in grams; defaults: offer 200, type 300, pss 1000'),
  grade: z.string().optional().describe('Grade if stated, e.g. AA, AB, PB'),
  roast_instructions: z.string().optional(),
});

const DEFAULT_QTY: Record<string, number> = { offer: 200, type: 300, pss: 1000 };

export default class CreateSampleRequestTool implements LuaTool {
  name = 'create_sample_request';
  description = 'Log one or more sample requests (one record per sample). Returns issued refs.';

  inputSchema = z.object({
    items: z.array(item).min(1),
    client_id: z.string().optional().describe('Client id from find_client, when resolved'),
    receiver: z.string().describe('Receiver/company name as stated, e.g. "Thomas Pitault at Beyers"'),
    requester: z.string().optional().describe('Who asked, e.g. "Omar"'),
    deadline: z.string().optional().describe('ISO date YYYY-MM-DD if a deadline was given'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const created = [];
    for (const it of input.items) {
      const row = await apiFetch('/samples', {
        method: 'POST',
        body: JSON.stringify({
          sample_type: it.sample_type,
          quality: it.quality,
          grade: it.grade ?? null,
          qty_grams: it.qty_grams ?? DEFAULT_QTY[it.sample_type] ?? null,
          roast_instructions: it.roast_instructions ?? null,
          client_id: input.client_id ?? null,
          receiver: input.receiver,
          requester: input.requester ?? null,
          deadline: input.deadline ?? null,
        }),
      });
      created.push({ ref: row.ref, quality: row.quality, qty_grams: row.qty_grams, status: row.status });
    }
    return { created };
  }
}
