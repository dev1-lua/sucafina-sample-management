import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class FindApprovedSamplesTool implements LuaTool {
  name = 'find_approved_samples';
  description =
    'List approved samples with their strategy, blend, and cup-profile highlights — newest first. Filter by client, cup profile (e.g. "hibiscus", "clean cup"), and/or grade/quality text. Answers "what approved coffees have this profile?" and "what was the blend of the latest AA FAQ approved by Paulig?" (the first result is the most recent).';

  inputSchema = z.object({
    client: z.string().optional().describe('Client name to scope to, e.g. "Paulig". Resolved to that client\'s record.'),
    cup_profile: z.string().optional().describe('Cup-profile highlight to match, e.g. "hibiscus", "blackcurrant", "clean cup".'),
    grade_or_quality: z.string().optional().describe('Grade/quality text to match, e.g. "AA FAQ", "AB".'),
    limit: z.number().int().min(1).max(50).optional().describe('Max rows to return (default 10).'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const params = new URLSearchParams({ result: 'approved', pageSize: String(input.limit ?? 10) });

    // Resolve a client name → id so the scope is exact (not a fuzzy text match on the sample rows).
    if (input.client) {
      const cr = await apiFetch(`/clients?q=${encodeURIComponent(input.client)}&pageSize=5`);
      const match = (cr.data ?? []).find((c: { name: string }) => c.name?.toLowerCase() === input.client!.toLowerCase()) ?? cr.data?.[0];
      if (!match) return { found: false, message: `No client matching "${input.client}"` };
      params.set('client_id', match.id);
    }
    if (input.cup_profile) params.set('highlights', input.cup_profile);
    if (input.grade_or_quality) params.set('q', input.grade_or_quality);

    const res = await apiFetch(`/search?${params}`);
    const samples = (res.data ?? []).map((r: Record<string, unknown>) => ({
      tab: r.tab,
      ref: r.ref,
      quality: r.title,
      blend: r.blend,
      strategy: r.strategy,
      highlights: r.highlights,
      approved_on: r.result_on ?? r.date_on,
    }));
    return { total: res.total, samples };
  }
}
