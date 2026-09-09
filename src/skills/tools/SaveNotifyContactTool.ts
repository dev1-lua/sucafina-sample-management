import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { isInternalEmail, resolveOrCreatePerson } from '../../lib/notify';
import { resolveSampleByRef, sampleEndpoint } from '../../lib/resolve-sample';
import { TABS } from '../../lib/normalize';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Keep-in-the-loop capture (feedback #34, Ivo Jr.): the person kept in the loop is
 * Sucafina's account manager for the client — one per client — plus anyone named
 * for a specific sample. This tool saves the person to the roster and attaches
 * them to a client (as its account manager) and/or to a sample (extra loop-in).
 *
 * Two guards added 2026-09-09:
 *  - a CLIENT's email (nestle.com, itochu.co.jp…) is never a colleague: it is saved on the client
 *    record as a contact instead, and the tool says so (RC7 — three customers had ended up on the
 *    roster as "traders" and were receiving internal status pings);
 *  - the client need not exist yet: "keep X in the loop for Beyers" before Beyers is in the book
 *    adds the shell (log first, complete later).
 */
export default class SaveNotifyContactTool implements LuaTool {
  name = 'save_notify_contact';
  description =
    'Keep a SUCAFINA COLLEAGUE in the loop on sample updates (preparing, dispatched, AWB). Pass `client` to make them that client\'s account manager — they are then updated automatically for EVERY sample to that client, now and in future (the client is added to the book if it isn\'t there yet). Pass `sample_ref` to add them to one sample only. Both may be given. Identify the person by name and/or email — an email alone is enough (the name is taken from it); a name alone is enough for someone already on the roster; a NEW person needs an email. A client\'s own email is NOT a colleague: it is saved on the client record (saved_as: client_contact) and the loop-in stays open. Saving SENDS NOTHING by itself — never tell the user a message went out; updates reach them as the sample progresses.';

  inputSchema = z.object({
    name: z
      .string()
      .optional()
      .describe('The colleague to keep in the loop, e.g. "Thomas", "Lena Berg" — the short name the desk uses if they are already on the roster. Optional when `email` is given.'),
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

    // 0) A client's own email belongs on the client, never on the internal roster.
    if (email && !isInternalEmail(email)) {
      const target = input.client
        ? await this.resolveClient(input.client)
        : await this.clientOfSample(input.sample_ref!, input.tab);
      if (!target) {
        return {
          saved: false,
          saved_as: 'client_contact',
          reason: `${email} is not a Sucafina address — it is the client's own contact, but this sample has no client on file to save it on.`,
        };
      }
      await apiFetch(`/clients/${target.id}/contacts`, {
        method: 'POST',
        body: JSON.stringify({ email, attention_to: nameIn }),
      });
      console.log(`save_notify_contact: ${email} is a CLIENT address — saved as a contact on "${target.name}", not on the roster`);
      return {
        saved: true,
        saved_as: 'client_contact',
        client: target.name,
        client_created: target.created === true,
        email,
        reason: `${email} is the client's own contact — saved on ${target.name}'s book entry (dispatch confirmations and feedback chasers go there). Status updates need a Sucafina colleague: the loop-in for ${target.name} is still open.`,
      };
    }

    // 1) Roster.
    const { person, matchedBy } = await resolveOrCreatePerson({ name: nameIn, email });

    // 2) Client → account manager (kept in the loop on every sample to that client).
    let attachedClient: { id: string; name: string; created?: boolean } | null = null;
    if (input.client) {
      const c = await this.resolveClient(input.client);
      await apiFetch(`/clients/${c.id}`, { method: 'PATCH', body: JSON.stringify({ account_owner_id: person.id }) });
      attachedClient = c;
      console.log(`save_notify_contact: ${person.name} is now account manager for client "${c.name}" (${c.id})${c.created ? ' — client added to the book' : ''}`);
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
      saved_as: 'roster',
      person: { name: person.name, email: person.email, role: person.role },
      matched_by: matchedBy,
      account_manager_for_client: attachedClient?.name ?? null,
      client_created: attachedClient?.created === true,
      added_to_sample: attachedSample?.ref ?? null,
      note: 'Saved. Nothing has been sent — they will receive updates as the sample progresses.',
    };
  }

  /** Resolve a client by id or exact name; a company not in the book yet is added from its name. */
  private async resolveClient(nameOrId: string): Promise<{ id: string; name: string; created?: boolean }> {
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
    if (hits.length === 0) {
      const shell = await apiFetch('/clients', { method: 'POST', body: JSON.stringify({ name: q }) });
      return { id: shell.id, name: shell.name, created: true };
    }
    throw new Error(`Several clients match "${q}": ${hits.map((r) => r.name).join('; ')}. Ask which one, then retry with the exact name.`);
  }

  private async clientOfSample(ref: string, tab?: (typeof TABS)[number]): Promise<{ id: string; name: string; created?: boolean } | null> {
    const { tab: t, id } = await resolveSampleByRef(ref, tab);
    const row = await apiFetch(`${sampleEndpoint(t)}/${id}`);
    if (!row.client_id) return null;
    const c = await apiFetch(`/clients/${row.client_id}`);
    return { id: c.id, name: c.name };
  }
}
