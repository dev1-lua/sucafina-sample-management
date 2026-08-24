import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { loadTraders, matchTrader } from '../../lib/notify';

export default class SaveNotifyContactTool implements LuaTool {
  name = 'save_notify_contact';
  description =
    'Save the email address of the person to keep in the loop on a sample — the Sales Trader who gets the automatic status updates (preparing, dispatched, AWB). Upserts the roster by name: an existing person keeps their roster name and role, only the email is filled in. Saving an email SENDS NOTHING by itself — never tell the user a ping or message went out because of this call; status updates reach them as the sample progresses.';

  inputSchema = z.object({
    name: z
      .string()
      .min(1)
      .describe('The person the email belongs to, e.g. "Muki", "Ivo" — the Sales Trader on the sample unless the user names someone else.'),
    email: z.string().email().describe('Their work email address.'),
    role: z
      .enum(['trader', 'qc'])
      .optional()
      .describe('Only pass when the user explicitly says the person is Quality-team ("qc"); otherwise omit — an existing roster row keeps its role, a new person defaults to trader.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    // Short first names are the roster keys ("Muki", not "Muki Kristiya Bongers"):
    // reuse a matched row's exact name AND role so the upsert updates in place
    // instead of creating a duplicate or flipping a QC member to trader.
    const match = matchTrader(input.name, await loadTraders());
    const row = await apiFetch('/traders', {
      method: 'POST',
      body: JSON.stringify({
        name: match?.name ?? input.name.trim(),
        email: input.email.trim().toLowerCase(),
        role: input.role ?? match?.role ?? 'trader',
        active: true,
      }),
    });
    console.log(
      `save_notify_contact: ${match ? `updated roster row "${row.name}"` : `created roster row "${row.name}"`} <${row.email}> role=${row.role}` +
        (match && match.name !== input.name.trim() ? ` (matched from "${input.name.trim()}")` : ''),
    );
    return {
      saved: true,
      updated_existing: Boolean(match),
      name: row.name,
      email: row.email,
      role: row.role,
    };
  }
}
