import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import {
  loadTraders,
  matchTraderByEmail,
  matchTraderCandidates,
  nameFromEmail,
  type TraderRow,
} from '../../lib/notify';
import { resolveSampleByRef, sampleEndpoint } from '../../lib/resolve-sample';
import { TABS } from '../../lib/normalize';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keep-in-the-loop capture (feedback #34, Ivo Jr.): the person kept in the loop is
 * Sucafina's account manager for the client — one per client — plus anyone named
 * for a specific sample. This tool saves the person to the roster and attaches
 * them to a client (as its account manager) and/or to a sample (extra loop-in).
 *
 * Roster resolution (one inbox = one person, never a duplicate row):
 *   1. email already on the roster → that row (whatever name the desk used in chat);
 *   2. unique name match → that row (email patched onto it when given);
 *   3. several name matches → refuse and list them ("which Thomas?");
 *   4. nobody → a NEW row needs an email; the name defaults from the email if none was given.
 */
export default class SaveNotifyContactTool implements LuaTool {
  name = 'save_notify_contact';
  description =
    'Keep someone in the loop on sample updates (preparing, dispatched, AWB). Pass `client` to make them that client\'s account manager — they are then updated automatically for EVERY sample to that client, now and in future. Pass `sample_ref` to add them to one sample only. Both may be given. Identify the person by name and/or email — an email alone is enough (the name is taken from it); a name alone is enough for someone already on the roster; a NEW person needs an email. Saving SENDS NOTHING by itself — never tell the user a message went out; updates reach them as the sample progresses.';

  inputSchema = z.object({
    name: z
      .string()
      .optional()
      .describe('The person to keep in the loop, e.g. "Thomas", "Lena Berg" — the short name the desk uses if they are already on the roster. Optional when `email` is given.'),
    email: z
      .string()
      .email()
      .optional()
      .describe('Their work email, exactly as given in the chat. Required for someone not yet on the roster; optional (updates it) for an existing person. Enough on its own — no need to ask for a name.'),
    client: z
      .string()
      .optional()
      .describe('Client name (or id) to make this person the account manager for — e.g. "Paulig". Use the client of the sample just logged when answering the intake question.'),
    sample_ref: z
      .string()
      .optional()
      .describe('Sample ref to add this person to, e.g. "TYPE-1020" — for "keep X in the loop on this one".'),
    tab: z.enum(TABS).optional().describe('Book of the sample, when known (disambiguates duplicate refs).'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    if (!input.client && !input.sample_ref) {
      throw new Error(
        'Say WHAT to keep them in the loop on: pass `client` (they become that client\'s account manager — every sample to that client) and/or `sample_ref` (this one sample only).',
      );
    }
    const nameIn = input.name?.trim() || null;
    const email = input.email?.trim().toLowerCase() || null;
    if (!nameIn && !email) {
      throw new Error('Say WHO to keep in the loop: pass their name and/or email.');
    }

    // 1) Roster.
    const { person, matchedBy } = await this.resolvePerson(nameIn, email);

    // 2) Client → account manager (kept in the loop on every sample to that client).
    let attachedClient: { id: string; name: string } | null = null;
    if (input.client) {
      const c = await this.resolveClient(input.client);
      await apiFetch(`/clients/${c.id}`, { method: 'PATCH', body: JSON.stringify({ account_owner_id: person.id }) });
      attachedClient = c;
      console.log(`save_notify_contact: ${person.name} is now account manager for client "${c.name}" (${c.id})`);
    }

    // 3) Sample → extra loop-in (this one sample only).
    let attachedSample: { tab: string; id: string; ref: string } | null = null;
    if (input.sample_ref) {
      const { tab, id } = await resolveSampleByRef(input.sample_ref, input.tab);
      const row = await apiFetch(`${sampleEndpoint(tab)}/${id}`);
      const current: string[] = Array.isArray(row.notify_trader_ids) ? row.notify_trader_ids : [];
      if (!current.includes(person.id)) {
        await apiFetch(`${sampleEndpoint(tab)}/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ notify_trader_ids: [...current, person.id] }),
        });
      }
      attachedSample = { tab, id, ref: String(row.ref ?? row.sample_ref ?? input.sample_ref) };
      console.log(`save_notify_contact: ${person.name} added to the loop on ${attachedSample.ref} (${tab})`);
    }

    return {
      saved: true,
      person: { name: person.name, email: person.email, role: person.role },
      matched_by: matchedBy,
      account_manager_for_client: attachedClient?.name ?? null,
      added_to_sample: attachedSample?.ref ?? null,
      note: 'Saved. Nothing has been sent — they will receive updates as the sample progresses.',
    };
  }

  /** See the class comment for the resolution order. Throws model-facing questions, never guesses. */
  private async resolvePerson(
    nameIn: string | null,
    email: string | null,
  ): Promise<{ person: TraderRow; matchedBy: 'email' | 'name' | 'created' }> {
    const traders = await loadTraders();

    const byEmail = matchTraderByEmail(email, traders);
    if (byEmail) {
      console.log(
        `save_notify_contact: roster row "${byEmail.name}" <${byEmail.email}> matched by email` +
          (nameIn && nameIn.toLowerCase() !== byEmail.name.toLowerCase() ? ` (chat said "${nameIn}")` : ''),
      );
      return { person: byEmail, matchedBy: 'email' };
    }

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
        console.log(`save_notify_contact: roster row "${person.name}" email updated to <${email}>`);
      } else {
        console.log(`save_notify_contact: roster row "${person.name}" <${person.email ?? 'no email'}> matched by name "${nameIn}"`);
      }
      return { person, matchedBy: 'name' };
    }

    if (!email) {
      throw new Error(
        `"${nameIn}" is not on the roster yet — ask for their work email once, then call again with name + email.`,
      );
    }
    // New person. Name defaults from the email; never collide with an existing roster name
    // (traders.name is UNIQUE and POST /traders upserts on it — a collision would overwrite
    // someone else's email).
    let newName = nameIn ?? nameFromEmail(email);
    if (traders.some((t) => t.name.trim().toLowerCase() === newName.toLowerCase())) {
      newName = `${newName} (${email})`;
    }
    const person = (await apiFetch('/traders', {
      method: 'POST',
      body: JSON.stringify({ name: newName, email, role: 'trader', active: true }),
    })) as TraderRow;
    console.log(`save_notify_contact: created roster row "${person.name}" <${person.email}> role=${person.role}`);
    return { person, matchedBy: 'created' };
  }

  private async resolveClient(nameOrId: string): Promise<{ id: string; name: string }> {
    const q = nameOrId.trim();
    if (UUID_RE.test(q)) {
      const c = await apiFetch(`/clients/${q}`);
      return { id: c.id, name: c.name };
    }
    const res = await apiFetch(`/clients?q=${encodeURIComponent(q)}&pageSize=50`);
    const rows: { id: string; name: string }[] = res.data ?? [];
    const exact = rows.filter((r) => r.name.trim().toLowerCase() === q.toLowerCase());
    const hits = exact.length ? exact : rows;
    if (hits.length === 1) return { id: hits[0]!.id, name: hits[0]!.name };
    if (hits.length === 0) throw new Error(`No client matching "${q}" — resolve it with find_client first and pass the exact name.`);
    throw new Error(`Several clients match "${q}": ${hits.map((r) => r.name).join('; ')}. Ask which one, then retry with the exact name.`);
  }
}
