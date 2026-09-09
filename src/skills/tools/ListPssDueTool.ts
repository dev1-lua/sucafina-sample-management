import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { contractsUrl } from '../../lib/links';

type PssCounts = { expected: number; approved: number; rejected: number; pending: number };

/** Whole days from today to `date` (negative = past). Dates are plain YYYY-MM-DD, so compare at UTC noon. */
function daysLeft(date: string | null): number | null {
  if (!date) return null;
  const due = Date.parse(`${String(date).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(due)) return null;
  const today = new Date();
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12);
  return Math.round((due - now) / 86_400_000);
}

export default class ListPssDueTool implements LuaTool {
  name = 'list_pss_due';
  description =
    'List the contracts whose pre-shipment samples are due (or overdue): what still has to reach the client and by when. Use for "what PSS are due", "anything overdue", "what do I owe this month". PSS are due 45 days before the shipment date.';

  inputSchema = z.object({
    days: z.number().int().min(0).max(365).optional().describe('Look ahead this many days from today (default 14).'),
    include_overdue: z.boolean().optional().describe('Include contracts already past their due date (default true).'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const days = input.days ?? 14;
    const includeOverdue = input.include_overdue ?? true;
    const res = await apiFetch(`/contracts/pss-due?days=${days}`);
    const items: any[] = Array.isArray(res.items) ? res.items : [];
    const cards = items
      .map((c) => {
        const counts = (c.pss_counts ?? {}) as PssCounts;
        return {
          id: String(c.id),
          contract_number: c.contract_number,
          client_name: c.client_name,
          quality: c.quality,
          destination: c.destination,
          shipment_date: c.shipment_date,
          pss_due_date: c.pss_due_date,
          days_left: daysLeft(c.pss_due_date),
          containers: c.containers,
          approved: counts.approved ?? 0,
          expected: counts.expected ?? c.pss_expected,
          missing_pss: c.missing_pss,
          status: c.status,
          url: contractsUrl(String(c.id)),
        };
      })
      .filter((c) => includeOverdue || c.days_left === null || c.days_left >= 0);
    return {
      days,
      include_overdue: includeOverdue,
      count: cards.length,
      overdue: cards.filter((c) => (c.days_left ?? 0) < 0).length,
      contracts: cards,
      contracts_url: contractsUrl(),
    };
  }
}
