import { LuaJob } from 'lua-cli';
import { apiFetch } from '../lib/api';
import { ccFor, isInternalEmail, nameFromEmail, sendToPerson } from '../lib/notify';
import { dashboardUrl } from '../lib/links';

// LOG FIRST, COMPLETE LATER (Beyers, 2026-09-08): a sample is written before the client's delivery
// address exists; request_missing_details records who was asked. This job is the "then you chase people
// down for the details you need" half — every morning it nudges the asked person, and after two
// unanswered nudges (or when nobody could be asked) escalates to the person who logged the sample and
// the client's account manager. It never expires: the API only lists asks whose client STILL has no
// address and still has a sample waiting to go out; QC ends it by shipping or cancelling.
//
// Registered in src/index.ts one agent version AFTER the tools (v53), per the one-job-per-version protocol.

export type PendingAsk = {
  id: string;
  client_id: string;
  client_name: string;
  missing: string[];
  asked_name: string | null;
  asked_email: string | null;
  asked_by: string | null;
  asked_by_email: string | null;
  note: string | null;
  via: 'teams' | 'email' | null;
  asked_at: string;
  chase_count: number;
  escalated_at: string | null;
  days_open: number;
  account_manager: { id: string; name: string; email: string | null } | null;
  samples: Array<{ tab: string; id: string; ref: string | null; title: string | null; qty_grams: number | null; date_on: string | null }>;
};

export type Recipient = { name: string; email: string };

/** Who gets this morning's nudge. Pure, so the harness can check every branch. */
export function chasePlan(a: PendingAsk): { recipients: Recipient[]; escalate: boolean } {
  const person = (name: string | null, email: string | null): Recipient | null =>
    email && isInternalEmail(email) ? { name: name ?? nameFromEmail(email), email: email.toLowerCase() } : null;
  const asked = person(a.asked_name, a.asked_email);
  const logger = person(a.asked_by, a.asked_by_email);
  const manager = person(a.account_manager?.name ?? null, a.account_manager?.email ?? null);
  if (asked && a.chase_count < 2) return { recipients: [asked], escalate: false };
  const seen = new Set<string>();
  const recipients = [asked, logger, manager].filter((r): r is Recipient => !!r && !seen.has(r.email) && !!seen.add(r.email));
  return { recipients, escalate: true };
}

function chaseText(a: PendingAsk, escalate: boolean): { text: string; subject: string } {
  const refs = a.samples.map((s) => s.ref).filter(Boolean).join(', ') || 'a sample';
  const logged = a.samples[0]?.date_on ? ` logged ${a.samples[0].date_on}` : '';
  const by = a.asked_by ? ` by ${a.asked_by}` : '';
  const url = dashboardUrl('clients', a.client_id, 'updated');
  const day = a.days_open + 1;
  const text = [
    `Still needed for ${a.client_name} (${refs}${logged}${by}): ${a.missing.join(', ')}.`,
    a.note ? `Note: "${a.note}"` : null,
    escalate && a.asked_name ? `${a.asked_name} was asked on ${a.asked_at.slice(0, 10)} — no answer yet.` : null,
    `Reply on Teams, REPLY ALL by email (a plain reply to this address is not read), or add it yourself: ${url}`,
  ].filter(Boolean).join('\n');
  return { text, subject: `${a.client_name}: delivery address still needed (day ${day})` };
}

async function mark(id: string, via: 'teams' | 'email' | 'skipped', detail: string, escalated: boolean) {
  await apiFetch('/notifications/details-mark', {
    method: 'POST',
    headers: { 'x-actor': 'job:details-chaser' },
    body: JSON.stringify({ id, via, detail, escalated }),
  });
}

/** One run. `deliver` is injectable so the harness never touches Teams/email. */
export async function runDetailsChaser(o: { deliver?: typeof sendToPerson } = {}) {
  const deliver = o.deliver ?? sendToPerson;
  const { items } = (await apiFetch('/notifications/details-pending', { headers: { 'x-actor': 'job:details-chaser' } })) as { items: PendingAsk[] };
  let chased = 0;
  let skipped = 0;
  let failures = 0;
  for (const a of items) {
    try {
      const { recipients, escalate } = chasePlan(a);
      if (!recipients.length) {
        await mark(a.id, 'skipped', 'nobody reachable: no asked person, logger or account manager with a Sucafina email', escalate);
        skipped += 1;
        continue;
      }
      const { text, subject } = chaseText(a, escalate);
      const delivered: Array<{ name: string; via: 'teams' | 'email' }> = [];
      let ccSent = false;
      for (const r of recipients) {
        const via = await deliver({ email: r.email, text, subject, cc: ccSent ? [] : ccFor(r.email) });
        if (via === 'email') ccSent = true;
        if (via) delivered.push({ name: r.name, via });
      }
      if (!delivered.length) {
        await mark(a.id, 'skipped', `unreachable: ${recipients.map((r) => r.name).join(', ')}`, escalate);
        skipped += 1;
        continue;
      }
      const anyTeams = delivered.some((d) => d.via === 'teams');
      const detail = delivered.map((d) => `${d.name} (${d.via})`).join(', ') + (ccSent ? ' · cc Specialty QC mailbox' : '');
      await mark(a.id, anyTeams ? 'teams' : 'email', detail, escalate);
      chased += 1;
      console.log(`details-chaser: ${a.client_name} chase #${a.chase_count + 1}${escalate ? ' (escalated)' : ''} → ${detail}`);
    } catch (e) {
      failures += 1;
      console.error(`details-chaser: failed for ${a.client_name} (${a.id})`, e);
    }
  }
  return { success: true, pending: items.length, chased, skipped, failures };
}

export const detailsChaserJob = new LuaJob({
  name: 'details-chaser',
  description: 'Every morning, chase the colleague asked for a client\'s missing delivery details until the address is saved',
  schedule: { type: 'cron', expression: '0 9 * * 1-6', timezone: 'Africa/Nairobi' },
  execute: async () => runDetailsChaser(),
});
