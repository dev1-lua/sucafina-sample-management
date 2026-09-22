import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
import { currentUser } from '../../lib/current-user';
import { clientGaps, getClient, isInternalOffice } from '../../lib/client-guard';
import {
  ccFor,
  isInternalEmail,
  loadTraders,
  matchTrader,
  matchTraderCandidates,
  nameFromEmail,
  resolveOrCreatePerson,
  sendToGroup,
  sendToPerson,
  type TraderRow,
} from '../../lib/notify';
import { currentConversation, GROUP_ASKS_ENABLED, matchParticipant, type Conversation, type ConversationParticipant } from '../../lib/conversation';
import { resolveSampleByRef, sampleEndpoint } from '../../lib/resolve-sample';
import { TABS } from '../../lib/normalize';

type Deliver = (o: { email: string; text: string; subject: string; cc?: string[]; emailOnly?: boolean }) => Promise<'teams' | 'email' | null>;
type DeliverGroup = (o: { conversationId: string; text: string }) => Promise<boolean>;
type Via = 'group' | 'teams' | 'email';
type Person = { name: string; email: string; trader_id: string | null };

/**
 * LOG FIRST, COMPLETE LATER (Beyers, 2026-09-08): the sample is already written; this routes the ask for
 * the client's missing details to the colleague who has them, records who was asked (once per client,
 * chased every morning by details-chaser), and reports exactly what happened so the model never claims
 * a message went out that didn't.
 *
 * Replaces notify_trader_missing_details, which took a name only, refused anyone not on the roster,
 * was warm-Teams-only with no email fallback, and had never delivered.
 *
 * Group chats: when the message arrived in a Teams GROUP chat, the ask is posted INTO THAT SAME CHAT
 * addressed to the colleague by name (they are there, or they are cold on Teams and a DM would never
 * reach them), and the email still goes with the QC desk + the person logging copied. Since lua-cli
 * 3.36 the runtime names the people in the chat, so "ask Tommie" finds Tommie Schretlen among them
 * first — and his Teams email, when shared, lands on the roster — before the roster is searched.
 */
export default class RequestMissingDetailsTool implements LuaTool {
  name = 'request_missing_details';
  description =
    'Route a missing-client-details ask (delivery address / country / contact person / phone / email) to the Sucafina colleague who has them, AFTER the sample is logged. Resolves the person by email first (a new colleague is added to the roster), then — in a Teams GROUP chat — among the people in this chat by name (their Teams email joins the roster), then by roster name; in a group chat it posts the ask into that same chat addressed to them by name AND emails them (QC mailboxes + the person logging copied); in a 1:1 it sends a Teams DM if they have chatted with me, otherwise the email; records who was asked and when on the client and the sample; the desk chases them every morning until the address is saved. With no to_name/to_email it asks the Sales Trader (when that is not the person logging), else the client\'s account manager, else just records the gap for the daily chase. A client\'s own email is never a recipient. Call at most ONCE per sample. Returns {delivered, via: group|teams|email|null, to, recorded, reason} — only say a message went out when delivered is true, and say WHERE (via).';

  inputSchema = z.object({
    sample_ref: z.string().min(1).describe('The sample just logged, e.g. "TYPE-113" — its client is who the details are for.'),
    tab: z.enum(TABS).optional().describe('Book of the sample, when known.'),
    receiver: z.string().optional().describe('Receiver / client name to pick the right send when the ref has several.'),
    to_email: z.string().email().optional().describe('Work email of the colleague who has the details (wins over to_name; a new colleague is added to the roster).'),
    to_name: z.string().optional().describe('Name of the colleague who has the details, e.g. "Tommie" — as said in the chat (a first name is enough when they are in this group chat), roster short name or full name.'),
    missing: z.array(z.string().min(1)).min(1).describe('Exactly what to ask for, e.g. ["full street address", "contact person", "phone"].'),
    note: z.string().optional().describe("The trader's own words about it, e.g. 'the lab has the address'."),
  });

  private deliver: Deliver;
  private deliverGroup: DeliverGroup;
  private conversation: () => Promise<Conversation>;
  private groupAsks: boolean;

  constructor(opts: { deliver?: Deliver; deliverGroup?: DeliverGroup; conversation?: () => Promise<Conversation>; groupAsks?: boolean } = {}) {
    this.deliver = opts.deliver ?? sendToPerson;
    this.deliverGroup = opts.deliverGroup ?? sendToGroup;
    this.conversation = opts.conversation ?? currentConversation;
    this.groupAsks = opts.groupAsks ?? GROUP_ASKS_ENABLED;
  }

  async execute(input: z.infer<typeof this.inputSchema>) {
    // 1. The sample and its client.
    const { tab, id } = await resolveSampleByRef(input.sample_ref, { tab: input.tab, receiver: input.receiver });
    const row = await apiFetch(`${sampleEndpoint(tab)}/${id}`);
    if (!row.client_id) {
      throw new Error(`${input.sample_ref} has no client linked — re-run the create with client_id, or add the client with upsert_client first.`);
    }
    const client = await getClient(row.client_id);
    if (isInternalOffice(client.name)) {
      throw new Error(`${client.name} is an internal Sucafina office — nothing to ask for.`);
    }
    const gaps = clientGaps(client, { requireCountry: tab === 'bulk' });
    if (!gaps.missing.length) {
      throw new Error(`${client.name} already has a delivery address on file — nothing to ask for. Only the optional details (${gaps.optional.join(', ') || 'none'}) are still empty.`);
    }
    const clientUrl = dashboardUrl('clients', client.id, 'updated');
    const ref = String(row.ref ?? row.sample_ref ?? input.sample_ref);
    const logger = await currentUser();

    // 2. Who to ask.
    let to: Person | null = null;
    let needsEmail = false;
    let reason: string | null = null;
    const traders = await loadTraders();
    const asPerson = (t: TraderRow | null): Person | null => (t?.email && isInternalEmail(t.email) ? { name: t.name, email: t.email, trader_id: t.id } : null);
    // The conversation is read once, up front: in a group chat the person named is looked up among the
    // people IN THE CHAT before the roster (lua-cli ≥ 3.36 hands them over), and the ask is posted there.
    const conv = this.groupAsks ? await this.conversation() : null;
    /** The chat participant the ask is addressed to — the group post uses their display name as Teams spells it. */
    let participant: ConversationParticipant | null = null;

    if (input.to_email) {
      if (!isInternalEmail(input.to_email)) {
        reason = `${input.to_email} is not a Sucafina address — that is the client's own contact, not a colleague. Save it on ${client.name} with upsert_client { email } if useful; the ask needs a Sucafina colleague (or nobody — I'll record the gap and the desk chases it).`;
      } else {
        const { person } = await resolveOrCreatePerson({ name: input.to_name, email: input.to_email });
        to = asPerson(person);
      }
    } else if (input.to_name) {
      // 2a. Someone in this chat? ("ask Tommie" → Tommie Schretlen, sitting right there.) Their Teams email,
      //     when shared and internal, goes onto the roster so the email leg and the daily chase reach them;
      //     a client's address on a participant is ignored (they are the customer, not a colleague).
      participant = conv?.isGroup ? matchParticipant(input.to_name, conv.participants) : null;
      const chatEmail = participant?.channelIdentity?.email?.trim().toLowerCase() || null;
      if (participant && chatEmail && isInternalEmail(chatEmail)) {
        const { person, matchedBy } = await resolveOrCreatePerson({ name: participant.displayName, email: chatEmail });
        to = asPerson(person);
        if (to) to = { ...to, name: matchedBy === 'created' ? participant.displayName : to.name };
      }
      if (!to) {
        // 2b. The roster, by the chat display name when there was one, else by the name as given.
        const lookup = participant?.displayName ?? input.to_name;
        const cands = matchTraderCandidates(lookup, traders);
        if (cands.length > 1) {
          throw new Error(`Several people on the roster match "${lookup}": ${cands.map((c) => c.name).join(', ')}. Ask which one (or their email) and retry.`);
        }
        const hit = cands[0] ?? null;
        to = asPerson(hit);
        if (!to) {
          needsEmail = true;
          reason = hit
            ? `${hit.name} is on the roster without a work email — ask for it once, then retry with to_email.`
            : `"${lookup}" is not on the roster — ask for their work email once, then retry with to_email. If nobody has it, call again with no to_name and I'll record the gap for the daily chase.`;
        }
      }
    } else {
      // Chain: Sales Trader (when not the person logging) → client's account manager → nobody.
      const requester = (row.requested_by as string | null) ?? null;
      if (requester && requester.trim().toLowerCase() !== (logger.name ?? '').trim().toLowerCase()) {
        to = asPerson(matchTrader(requester, traders));
      }
      if (!to) {
        const full = await apiFetch(`/clients/${client.id}`);
        const owner = full?.account_owner as { id?: string; name?: string; email?: string | null } | null;
        if (owner?.email && isInternalEmail(owner.email)) to = { name: owner.name ?? nameFromEmail(owner.email), email: owner.email, trader_id: owner.id ?? null };
      }
      if (!to) reason = `Nobody to ask: the Sales Trader${requester ? ` (${requester})` : ''} has no work email on the roster and ${client.name} has no account manager. The gap is recorded; the desk chases the person logging each morning until the address is saved.`;
    }

    // 3. Deliver — in a group chat: post the ask into that chat + email; in a 1:1: Teams DM if warm, else
    //    email. The email always copies the QC desk + the person logging.
    let via: Via | null = null;
    let alsoEmailed = false;
    let groupConversation: string | null = null;
    const missing = [...new Set([...input.missing.map((m) => m.trim()).filter(Boolean)])];
    if (to) {
      const open = await this.openRefs(client.id);
      const refs = open.length ? open : [ref];
      const first = to.name.split(/\s+/)[0];
      const who = logger.name ?? 'A colleague';
      const summary = [row.quality ?? row.description ?? row.coffee_quality, row.qty_grams ? `${row.qty_grams >= 1000 ? `${row.qty_grams / 1000} kg` : `${row.qty_grams} g`}` : null, row.sample_type_norm]
        .filter(Boolean).join(' · ') + ` → ${client.name}`;
      const text = [
        `Hi ${first} — ${who} logged ${refs.join(', ')} (${summary}) and the lab can't send it yet: ${client.name} has no delivery address in the sample book.`,
        `Could you send:`,
        ...missing.map((m) => `- ${m}`),
        input.note ? `Note from ${who}: "${input.note}"` : null,
        `How to reply: on Teams, just answer me here. By email, use REPLY ALL — the Kenya QC desk${logger.email ? ` and ${who}` : ''} are copied and will save it (a plain reply to this address is not read). Or add it yourself: ${clientUrl}`,
        `I'll nudge again each morning until it's in.`,
      ].filter(Boolean).join('\n');
      const subject = `${client.name}: delivery address needed for ${refs.join(', ')}`;
      const cc = [...ccFor(to.email), ...(logger.email && isInternalEmail(logger.email) && logger.email !== to.email ? [logger.email] : [])];

      // Group chat: the ask goes into the chat the request was made in, addressed to the person by the
      // name Teams shows for them (the roster's short name otherwise).
      if (conv?.isGroup && conv.conversationId) {
        groupConversation = conv.conversationId;
        const groupText = [
          `@${participant?.displayName ?? to.name} — ${who} logged ${refs.join(', ')} (${summary}); the lab can't send it yet: ${client.name} has no delivery address in the sample book. Could you send:`,
          ...missing.map((m) => `- ${m}`),
          input.note ? `Note from ${who}: "${input.note}"` : null,
          `Reply here (@mention me) or add it yourself: ${clientUrl} — I'm emailing you too, with the Kenya QC desk copied.`,
        ].filter(Boolean).join('\n');
        try {
          if (await this.deliverGroup({ conversationId: conv.conversationId, text: groupText })) via = 'group';
        } catch (e) {
          console.error(`request_missing_details: group post to ${conv.conversationId} failed`, e);
        }
      }

      try {
        // After a group post the DM leg is skipped (the ask is already in front of them); the email still goes.
        const r = await this.deliver({ email: to.email, text, subject, cc, emailOnly: via === 'group' });
        if (via === 'group') alsoEmailed = r === 'email';
        else via = r;
      } catch (e) {
        console.error(`request_missing_details: delivery to ${to.email} failed`, e);
        if (via !== 'group') via = null;
      }
      if (!via) reason = `Couldn't reach ${to.name}${groupConversation ? ' in this chat,' : ''} on Teams or email — the gap is recorded and the desk retries each morning.`;
    }

    // 4. Record the ask on the client (+ the sample's timeline) — always, delivered or not.
    let recorded = false;
    try {
      await apiFetch(`/clients/${client.id}/detail-requests`, {
        method: 'POST',
        body: JSON.stringify({
          missing,
          asked_name: to?.name ?? null,
          asked_email: to?.email ?? null,
          asked_trader_id: to?.trader_id ?? null,
          asked_by: logger.name,
          asked_by_email: logger.email,
          note: input.note ?? null,
          via,
          samples: [{ tab, id }],
        }),
      });
      recorded = true;
    } catch (e) {
      // Old API (no 016 yet) or a race with the address landing — never fail the flow over bookkeeping.
      console.warn(`request_missing_details: could not record the ask for ${client.name}`, (e as Error)?.message ?? e);
    }

    const delivered = via !== null;
    console.log(
      `request_missing_details: ${ref} → ${to ? `${to.name} <${to.email}>` : 'nobody'} ${delivered ? `delivered via ${via}` : `NOT delivered (${reason ?? 'unknown'})`}; recorded=${recorded}`,
    );
    return {
      delivered,
      via,
      // via 'group': posted into this Teams group chat, addressed to them — say "asked <name> here in the chat".
      ...(groupConversation ? { group_conversation: groupConversation, also_emailed: alsoEmailed } : {}),
      to: to ? { name: to.name, email: to.email } : null,
      recorded,
      needs_email: needsEmail,
      missing,
      covers: [ref],
      chase: 'every morning at 09:00 Nairobi until the address is saved',
      client_url: clientUrl,
      ...(reason ? { reason } : {}),
    };
  }

  /** Refs of the client's samples still waiting to go out — one ask covers all of them. */
  private async openRefs(clientId: string): Promise<string[]> {
    try {
      const res = await apiFetch(`/search?client_id=${encodeURIComponent(clientId)}&status=requested,preparing&pageSize=20`);
      return (res.data ?? []).map((r: any) => String(r.ref)).filter(Boolean);
    } catch {
      return [];
    }
  }
}
