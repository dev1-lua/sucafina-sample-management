import { Lua } from 'lua-cli';

// The Beyers incident (round 6, 2026-09-08): Ivo @mentioned the bot in a Teams GROUP chat that included
// Tommie and said "ask Tommie for the Beyers address". The ask must land in that same chat, addressed to
// Tommie — not in a DM he may never see. This module is the one place that knows what "the current
// conversation" is: read from the runtime's request context, never guessed from who said what.
//
// Since lua-cli 3.36 the runtime hands the group chat over directly (`Lua.request.conversation`: kind,
// the Teams conversation id and the PEOPLE in it, current speaker first) — that is read first; the
// webhook-payload parser below stays as the fallback for an older runtime.

/** One person in the chat, as the platform resolves them — the display name is never taken from the message. */
export type ConversationParticipant = {
  userId: string;
  displayName: string;
  isCurrentSpeaker?: boolean;
  channelIdentity?: { provider: string; externalId: string; email?: string };
};

export type Conversation = {
  channel: string | null;
  /** Teams conversation id, e.g. "19:…@thread.v2" for a group chat; null when the runtime carried none. */
  conversationId: string | null;
  isGroup: boolean;
  /** The people in the chat (current speaker first, capped at 50 by the platform); empty on a 1:1 or an old runtime. */
  participants: ConversationParticipant[];
  /** Which request field the conversation was read from — printed on the soak log line so the field can be pinned. */
  source: 'request.conversation' | 'webhook.conversation' | 'webhook.activity' | 'webhook.flat' | 'none';
};

/**
 * Group-aware asks are live (round 10, lua-cli ≥ 3.36): request_missing_details posts the ask into the
 * Teams group chat the request came from, addressed to the colleague by name. Flip to false to fall
 * back to the v52 behaviour (Teams DM, else email) without a code change elsewhere.
 */
export const GROUP_ASKS_ENABLED = true;

/**
 * Teams conversation ids by shape: group chats and meeting chats are "19:<id>@thread.v2", channel posts
 * "19:<id>@thread.tacv2" (older tenants "@thread.skype"); a personal chat with the bot is "a:1<…>".
 * Used only when the payload does not say `conversationType` outright.
 */
export function isGroupConversationId(id: string | null | undefined): boolean {
  if (!id) return false;
  return /^19:[^@\s]+@thread\.(v2|tacv2|skype)$/i.test(id.trim());
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Pull the conversation out of an inbound Teams payload. Bot Framework activities carry
 * `conversation: { id, conversationType: 'personal' | 'groupChat' | 'channel', isGroup }` at the root
 * (or under `activity` when the platform wraps it); a flat `conversationId` is accepted too. Pure.
 */
export function conversationFromPayload(payload: unknown, channel: string | null): Conversation {
  const root = obj(payload);
  const candidates: Array<[Raw | null, Conversation['source']]> = [
    [obj(root?.conversation), 'webhook.conversation'],
    [obj(obj(root?.activity)?.conversation), 'webhook.activity'],
  ];
  for (const [conv, source] of candidates) {
    const id = str(conv?.id);
    if (!id) continue;
    const type = str(conv?.conversationType)?.toLowerCase() ?? null;
    const isGroup =
      type === 'personal' ? false
        : conv?.isGroup === true || type === 'groupchat' || type === 'channel' || (type === null && isGroupConversationId(id));
    return { channel, conversationId: id, isGroup, source, participants: [] };
  }
  const flat = str(root?.conversationId) ?? str(root?.conversation_id);
  if (flat) return { channel, conversationId: flat, isGroup: isGroupConversationId(flat), source: 'webhook.flat', participants: [] };
  return { channel, conversationId: null, isGroup: false, source: 'none', participants: [] };
}

/** The slice of `Lua.request` this module reads — `conversation` as lua-cli's ConversationRef carries it. */
export type RequestLike = {
  channel?: string;
  conversation?: {
    id?: string;
    kind?: string;
    channel?: string;
    externalId?: string;
    currentSpeakerId?: string;
    participants?: ConversationParticipant[];
    participantCount?: number;
    truncated?: boolean;
  };
  webhook?: { payload?: unknown };
};

/** Pure: the conversation from a request — `conversation` (lua-cli ≥ 3.36) first, the webhook payload as fallback. */
export function conversationFromRequest(req: RequestLike | undefined): Conversation {
  const channel = req?.channel ?? req?.conversation?.channel ?? null;
  const conv = req?.conversation;
  if (conv) {
    return {
      channel,
      conversationId: str(conv.externalId),
      isGroup: conv.kind === 'group',
      participants: (conv.participants ?? []).map((p) => ({
        userId: String(p.userId ?? ''),
        displayName: String(p.displayName ?? '').trim(),
        ...(p.isCurrentSpeaker ? { isCurrentSpeaker: true } : {}),
        ...(p.channelIdentity ? { channelIdentity: p.channelIdentity } : {}),
      })),
      source: 'request.conversation',
    };
  }
  return conversationFromPayload(req?.webhook?.payload, channel);
}

const NONE: Conversation = { channel: null, conversationId: null, isGroup: false, source: 'none', participants: [] };

/**
 * The conversation the current message arrived in, from the runtime's request context. Never throws
 * (outside the Lua runtime — the harnesses — there is no request, and that is a 1:1 for our purposes).
 * Logs one diagnostic line — keys and counts only, never message text or names.
 */
export async function currentConversation(): Promise<Conversation> {
  try {
    const req = (Lua as { request?: RequestLike } | undefined)?.request;
    const c = conversationFromRequest(req);
    const payload = req?.webhook?.payload;
    const keys = obj(payload) ? Object.keys(obj(payload)!).slice(0, 25).join(',') : String(typeof payload);
    console.log(`conversation: channel=${c.channel ?? '?'} id=${c.conversationId ?? '-'} group=${c.isGroup} source=${c.source} participants=${c.participants.length} payloadKeys=[${keys}]`);
    return c;
  } catch (e) {
    console.warn('conversation: request context unavailable', (e as Error)?.message ?? e);
    return NONE;
  }
}

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The participant a speaker named ("ask Tommie"): a whole-word match on the display name first
 * ("Tommie" → "Tommie Schretlen"), then a substring match. Case-insensitive. Two people matching is a
 * model-facing throw — better a question than the wrong person's ask. Nobody → null (the roster is next).
 */
export function matchParticipant(name: string | null | undefined, participants: ConversationParticipant[]): ConversationParticipant | null {
  const q = (name ?? '').trim().toLowerCase();
  if (!q || !participants.length) return null;
  const qWords = words(q);
  const whole = participants.filter((p) => {
    const w = words(p.displayName);
    return qWords.length > 0 && qWords.every((qw) => w.includes(qw));
  });
  const hits = whole.length ? whole : participants.filter((p) => p.displayName.toLowerCase().includes(q));
  if (hits.length > 1) {
    throw new Error(`Several people in this chat match "${name!.trim()}": ${hits.map((p) => p.displayName).join(', ')}. Ask which one and retry with their full name.`);
  }
  return hits[0] ?? null;
}

/**
 * The participant whose Teams identity carries this work email, if they are in the chat (case-insensitive).
 * request_missing_details uses it to decide whether an @Name post into the group would actually be seen:
 * a colleague named by email, or picked by the Sales-Trader / account-manager chain, is only addressed in
 * the chat when they are IN it — otherwise the ask goes to them directly. Null when nobody matches.
 */
export function participantByEmail(email: string | null | undefined, participants: ConversationParticipant[]): ConversationParticipant | null {
  const e = (email ?? '').trim().toLowerCase();
  if (!e) return null;
  return participants.find((p) => (p.channelIdentity?.email ?? '').trim().toLowerCase() === e) ?? null;
}
