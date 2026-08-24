import { Channels, User } from 'lua-cli';
import { apiFetch } from './api';

// People directory + person-level delivery for the proactive notifications
// (feedback #29/#30). The traders table is the roster: role 'qc' = the Quality
// team, role 'trader' = sales traders. Delivery order per person: warm Teams DM
// (User.get by email — only resolves if they've DM'd the bot before), then email.

export type TraderRow = {
  id: string;
  name: string;
  email: string | null;
  role: 'trader' | 'qc';
  active: boolean;
};

export async function loadTraders(): Promise<TraderRow[]> {
  const res = await apiFetch('/traders'); // active rows only
  return (res.data ?? []) as TraderRow[];
}

const tokens = (s: string) => s.trim().toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Match a free-text person name against the roster. The roster keeps short names
 * ("Muki") while sample rows may carry full Teams names ("Muki Kristiya Bongers"),
 * so a shared word either way counts. Ambiguous (2+ hits) returns null — better
 * no ping than the wrong person's ping.
 */
export function matchTrader(name: string | null | undefined, traders: TraderRow[]): TraderRow | null {
  const nToks = tokens(name ?? '');
  if (!nToks.length) return null;
  const exact = traders.find((t) => t.name.trim().toLowerCase() === name!.trim().toLowerCase());
  if (exact) return exact;
  const hits = traders.filter((t) => tokens(t.name).some((tok) => nToks.includes(tok)));
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * Roster gap-check for a sample's Sales Trader (feedback #34). Returns null when
 * the trader already has an email on file (or no name was recorded) — the intake
 * skill then skips its notify-contact question. Never throws: a create must not
 * fail because the roster couldn't be read.
 */
export async function notifyContactGap(
  requestedBy: string | null | undefined,
): Promise<{ sales_trader: string; email_on_file: false } | null> {
  const name = (requestedBy ?? '').trim();
  if (!name) return null;
  try {
    const match = matchTrader(name, await loadTraders());
    if (match?.email) return null;
    console.log(
      `notify: no email on file for Sales Trader "${match?.name ?? name}"${match ? '' : ' (not on the roster)'} — intake will ask for a notify contact`,
    );
    return { sales_trader: match?.name ?? name, email_on_file: false };
  } catch (e) {
    console.warn(`notify: roster check for "${name}" failed — skipping notify-contact gap`, e);
    return null;
  }
}

/**
 * Deliver one message to one person: warm Teams DM first, email fallback.
 * Returns how it went out, or null when neither channel could deliver.
 */
export async function sendToPerson(
  o: { email: string; text: string; subject: string },
): Promise<'teams' | 'email' | null> {
  try {
    const user = await User.get({ email: o.email });
    if (user) {
      await user.send([{ type: 'text', text: o.text }]);
      return 'teams';
    }
  } catch (e) {
    console.warn(`notify: Teams DM to ${o.email} failed, falling back to email`, e);
  }
  try {
    const html = `<p>${o.text.replace(/\n/g, '<br>')}</p>`;
    await Channels.email.send({ to: { email: o.email }, subject: o.subject, html });
    return 'email';
  } catch (e) {
    console.error(`notify: email to ${o.email} failed`, e);
    return null;
  }
}
