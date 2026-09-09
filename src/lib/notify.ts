import { Channels, User } from 'lua-cli';
import { apiFetch } from './api';
import { currentUser } from './current-user';
import { isInternalEmail, nameFromEmail } from './names';

export { isInternalEmail, nameFromEmail, INTERNAL_EMAIL_DOMAINS } from './names';

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
  const hits = matchTraderCandidates(name, traders);
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * Every roster row a free-text name could mean: an exact (case-insensitive) name match wins
 * outright; otherwise every row sharing a word. Callers that can ask a human (save_notify_contact)
 * use this to say "which Thomas?" instead of silently creating a third one.
 */
export function matchTraderCandidates(name: string | null | undefined, traders: TraderRow[]): TraderRow[] {
  const nToks = tokens(name ?? '');
  if (!nToks.length) return [];
  const exact = traders.find((t) => t.name.trim().toLowerCase() === name!.trim().toLowerCase());
  if (exact) return [exact];
  return traders.filter((t) => tokens(t.name).some((tok) => nToks.includes(tok)));
}

/** The roster row with this email (case-insensitive), if any — one inbox is one person. */
export function matchTraderByEmail(email: string | null | undefined, traders: TraderRow[]): TraderRow | null {
  const e = (email ?? '').trim().toLowerCase();
  if (!e) return null;
  return traders.find((t) => (t.email ?? '').trim().toLowerCase() === e) ?? null;
}

/**
 * Resolve a chat-supplied person to ONE roster row, creating it when needed (one inbox = one person):
 *   1. email already on the roster → that row (whatever name the desk used in chat);
 *   2. unique name match → that row (email patched onto it when given);
 *   3. several name matches → throw a model-facing "which one?" listing them;
 *   4. nobody → a NEW row needs an email (name defaults from the email; never collides with an
 *      existing roster name, since traders.name is UNIQUE and POST /traders upserts on it).
 * A CLIENT's email is refused here — it belongs on the client record, not the internal roster (RC7).
 */
export async function resolveOrCreatePerson(o: {
  name?: string | null;
  email?: string | null;
}): Promise<{ person: TraderRow; matchedBy: 'email' | 'name' | 'created' }> {
  const nameIn = o.name?.trim() || null;
  const email = o.email?.trim().toLowerCase() || null;
  if (!nameIn && !email) throw new Error('Say WHO: pass their name and/or email.');
  if (email && !isInternalEmail(email)) {
    throw new Error(
      `${email} is not a Sucafina address — that is a client contact, not a colleague. Save it on the client (upsert_client { name, email }); status updates and detail asks need a Sucafina colleague.`,
    );
  }
  const traders = await loadTraders();
  const byEmail = matchTraderByEmail(email, traders);
  if (byEmail) return { person: byEmail, matchedBy: 'email' };
  const candidates = nameIn ? matchTraderCandidates(nameIn, traders) : [];
  if (candidates.length > 1) {
    throw new Error(
      `Several people on the roster match "${nameIn}": ${candidates.map((c) => c.name).join(', ')}. ` +
        'Ask which one, then retry with that exact roster name (or their email). If it is a NEW person, give their full name and email.',
    );
  }
  if (candidates.length === 1) {
    let person = candidates[0]!;
    if (email && (person.email ?? '').toLowerCase() !== email) {
      person = (await apiFetch(`/traders/${person.id}`, { method: 'PATCH', body: JSON.stringify({ email }) })) as TraderRow;
      console.log(`roster: "${person.name}" email updated to <${email}>`);
    }
    return { person, matchedBy: 'name' };
  }
  if (!email) {
    throw new Error(`"${nameIn}" is not on the roster yet — ask for their work email once, then call again with name + email.`);
  }
  let newName = nameIn ?? nameFromEmail(email);
  if (traders.some((t) => t.name.trim().toLowerCase() === newName.toLowerCase())) newName = `${newName} (${email})`;
  const person = (await apiFetch('/traders', {
    method: 'POST',
    body: JSON.stringify({ name: newName, email, role: 'trader', active: true }),
  })) as TraderRow;
  console.log(`roster: created "${person.name}" <${person.email}> role=${person.role}`);
  return { person, matchedBy: 'created' };
}

const touched = new Set<string>();

/**
 * Roster self-heal: the real traders (Ivo, Muki, Omar…) sit on the roster WITHOUT an email, so they
 * can never be pinged — which is exactly what makes the loop-in question fire so often. Whenever a
 * colleague chats, patch their email onto the one roster row that shares their name. Once per user
 * per process; never throws.
 */
export async function touchRoster(): Promise<void> {
  try {
    const me = await currentUser();
    if (!me.email || !isInternalEmail(me.email) || touched.has(me.email)) return;
    touched.add(me.email);
    const traders = await loadTraders();
    if (matchTraderByEmail(me.email, traders)) return;
    const cands = matchTraderCandidates(me.name, traders).filter((t) => !t.email);
    if (cands.length !== 1) return;
    await apiFetch(`/traders/${cands[0]!.id}`, { method: 'PATCH', body: JSON.stringify({ email: me.email }) });
    console.log(`roster: self-heal — "${cands[0]!.name}" now has email <${me.email}> (from the chatting user)`);
  } catch (e) {
    console.warn('roster: self-heal skipped', (e as Error)?.message ?? e);
  }
}

/**
 * "Keep in the loop" gap-check for a sample's client (feedback #34, Ivo Jr. 2026-08-25):
 * the person kept in the loop is Sucafina's ACCOUNT MANAGER for the client (one per
 * client, clients.account_owner_id). Returns null when the client already has a
 * manager with an email (or the sample has no client) — the intake skill then skips
 * its question. Never throws: a create must not fail because the lookup failed.
 */
export async function notifyContactGap(
  clientId: string | null | undefined,
): Promise<{ client: string; client_id: string; account_manager: string | null; email_on_file: false } | null> {
  if (!clientId) return null;
  try {
    const c = await apiFetch(`/clients/${encodeURIComponent(clientId)}`);
    const owner = c?.account_owner as { name?: string; email?: string | null } | null;
    if (owner?.email) return null;
    console.log(
      `notify: client "${c?.name}" has ${owner ? `account manager "${owner.name}" without an email` : 'no account manager'} — intake will ask who to keep in the loop`,
    );
    return { client: String(c?.name ?? ''), client_id: String(clientId), account_manager: owner?.name ?? null, email_on_file: false };
  } catch (e) {
    console.warn(`notify: account-manager check for client ${clientId} failed — skipping loop-in gap`, e);
    return null;
  }
}

/**
 * Whether the agent has a working outbound email channel. True since 2026-08-24:
 * generated inbox ping@heymail.ai (display name "Sucafina Samples") via the admin
 * dashboard. If the channel is ever removed, flip this back to false — without a
 * channel Channels.email.send silently ACCEPTS mail that never lands, which would
 * mark notifications delivered when they weren't.
 */
export const EMAIL_CHANNEL_READY = true;

/**
 * Kenya Specialty QC desk mailbox — copied on every outgoing email, internal pings and
 * client-facing mail alike (requested 2026-09-03). Attached in `sendEmail`, the one seam
 * every send goes through; status-notifier passes `cc: []` after the first email of an
 * event so the shared mailbox gets one copy per event, not one per recipient.
 */
export const NOTIFY_CC = ['kenyacof.specialtyqc@sucafina.com'];

/** CC list for one email — never CC the mailbox on mail addressed to itself. */
export function ccFor(to: string): string[] {
  const lower = to.trim().toLowerCase();
  return NOTIFY_CC.filter((a) => a.toLowerCase() !== lower);
}

/**
 * Send one email through the agent's channel. `cc` defaults to the QC desk mailbox;
 * pass `[]` to send without it. Every outgoing email must go through here.
 */
export async function sendEmail(o: { to: string; subject: string; html: string; cc?: string[] }) {
  const cc = o.cc ?? ccFor(o.to);
  return Channels.email.send({
    to: { email: o.to },
    subject: o.subject,
    html: o.html,
    ...(cc.length ? { cc } : {}),
  });
}

/**
 * Footer on every notification EMAIL — never on Teams pings. Someone only lands on the
 * email leg because they're cold on Teams (never DM'd the bot), so the footer is the
 * nudge to fix exactly that.
 */
const EMAIL_FOOTER =
  '<p style="margin:16px 0 0;color:#6b7280;font-size:13px">Sent by Lua Sample Manager &rarr; Add me to your Teams Chat to send sample requests directly to Quality, and stay in the loop.</p>';

/**
 * Deliver one message to one person: warm Teams DM first, email fallback. The email leg
 * CCs the QC desk mailbox unless `cc` is given (callers pass `[]` to dedupe per event).
 * Returns how it went out, or null when neither channel could deliver.
 */
export async function sendToPerson(
  o: { email: string; text: string; subject: string; cc?: string[] },
): Promise<'teams' | 'email' | null> {
  try {
    const user = await User.get({ email: o.email });
    const userId: string | undefined = user?._luaProfile?.userId ?? user?.userId;
    if (userId) {
      // Pin the channel. Channels.send on 'teams' is warm-only: it rejects when this person has
      // no Teams conversation with the bot, and we fall through to email. The previous
      // `user.send(...)` posted into WHATEVER channel the email was last seen on (web chat, dev
      // console) and reported success — prod QA 2026-08-26 lost a ping that way.
      const r = await Channels.send({ channel: 'teams', to: { userId }, text: o.text });
      if (r?.delivered) return 'teams';
      console.warn(`notify: Teams send to ${o.email} not delivered (${JSON.stringify(r)}), falling back to email`);
    }
  } catch (e) {
    console.warn(`notify: Teams DM to ${o.email} unavailable (not warm on Teams?), falling back to email —`, (e as Error)?.message ?? e);
  }
  if (!EMAIL_CHANNEL_READY) {
    console.warn(`notify: email to ${o.email} not attempted — no email channel wired yet (Teams-only until then)`);
    return null;
  }
  try {
    const html = `<p>${o.text.replace(/\n/g, '<br>')}</p>${EMAIL_FOOTER}`;
    await sendEmail({ to: o.email, subject: o.subject, html, cc: o.cc });
    return 'email';
  } catch (e) {
    console.error(`notify: email to ${o.email} failed`, e);
    return null;
  }
}
