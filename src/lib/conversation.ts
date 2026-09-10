import { Lua } from 'lua-cli';

// The Beyers incident (round 6, 2026-09-08): Ivo @mentioned the bot in a Teams GROUP chat that included
// Tommie and said "ask Tommie for the Beyers address". The ask must land in that same chat, addressed to
// Tommie — not in a DM he may never see. This module is the one place that knows what "the current
// conversation" is: read from the runtime's request context, never guessed from who said what (the bot
// cannot attribute speakers in a group, so nothing here ever tries).

export type Conversation = {
  channel: string | null;
  /** Teams conversation id, e.g. "19:…@thread.v2" for a group chat; null when the runtime carried none. */
  conversationId: string | null;
  isGroup: boolean;
  /** Which request field the id was read from — printed on the soak log line so the field can be pinned. */
  source: 'webhook.conversation' | 'webhook.activity' | 'webhook.flat' | 'none';
};

/**
 * v56 gate (the group-aware ask ships in its own agent version, with the governance guard): while false,
 * request_missing_details behaves exactly as in v52 (Teams DM, else email). Flip to true in v56.
 */
export const GROUP_ASKS_ENABLED = false;

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
    return { channel, conversationId: id, isGroup, source };
  }
  const flat = str(root?.conversationId) ?? str(root?.conversation_id);
  if (flat) return { channel, conversationId: flat, isGroup: isGroupConversationId(flat), source: 'webhook.flat' };
  return { channel, conversationId: null, isGroup: false, source: 'none' };
}

const NONE: Conversation = { channel: null, conversationId: null, isGroup: false, source: 'none' };

/**
 * The conversation the current message arrived in, from the runtime's request context. Never throws
 * (outside the Lua runtime — the harnesses — there is no request, and that is a 1:1 for our purposes).
 * Logs one diagnostic line — keys only, never message text — so the sandbox soak shows which field the
 * platform actually carries the id in.
 */
export async function currentConversation(): Promise<Conversation> {
  try {
    const req = (Lua as { request?: { channel?: string; webhook?: { payload?: unknown } } } | undefined)?.request;
    const channel = req?.channel ?? null;
    const payload = req?.webhook?.payload;
    const c = conversationFromPayload(payload, channel);
    const keys = obj(payload) ? Object.keys(obj(payload)!).slice(0, 25).join(',') : String(typeof payload);
    console.log(`conversation: channel=${channel ?? '?'} id=${c.conversationId ?? '-'} group=${c.isGroup} source=${c.source} payloadKeys=[${keys}]`);
    return c;
  } catch (e) {
    console.warn('conversation: request context unavailable', (e as Error)?.message ?? e);
    return NONE;
  }
}
