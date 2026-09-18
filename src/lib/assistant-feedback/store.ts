/**
 * Assistant-feedback Data access — the ONLY file that touches the `assistant_feedback_sessions` /
 * `assistant_feedback_entries` collections and the `config` flag row. (The rest of this agent keeps its
 * records in the sample API; this module lives in Lua Data so it ships without an API deploy and the
 * flag flips without a redeploy.)
 *
 * Every update re-sends the FULL row, so it is correct whether Data.update merges or replaces.
 * Each function is one read or one write; the CALLER owns the try/catch policy. The one composite,
 * closeSession, is idempotent so the gate and the sweeper can race safely.
 */
import { Data, type LuaQuery } from 'lua-cli';
import { loadTraders, matchTraderByEmail } from '../notify';
import { composeCloseFields, makeSessionId, parseFeedbackAccess, type FeedbackAccess, type FeedbackCategory } from './state';

export const SESSIONS = 'assistant_feedback_sessions';
export const ENTRIES = 'assistant_feedback_entries';
export const CONFIG = 'config';
export const FLAG_KEY = 'assistant_feedback_enabled';

export type CloseReason = 'expired' | 'swept';

export interface SessionIdentity {
  name: string;
  email: string;
  /** Roster role — 'trader' | 'qc' — or '' when the sender is not on the roster. */
  role: string;
}

export interface FeedbackSessionData extends SessionIdentity {
  session_id: string;
  channel: string;
  status: 'open' | 'closed';
  close_reason: CloseReason | null;
  categories: string[];
  message_count: number;
  feedback_text: string;
  sheet_pushed: boolean;
  sheet_push_error: string | null;
  started_at: string;
  closed_at: string | null;
}

export interface FeedbackEntryData {
  session_id: string;
  text: string;
  category: FeedbackCategory;
  email: string;
  created_at: string;
}

/** One config row, key assistant_feedback_enabled: true = everyone, array = pilot allowlist,
 * false/absent/garbage = dark. One read either way. */
export async function readFeedbackAccess(): Promise<FeedbackAccess> {
  const res = await Data.get(CONFIG, { key: FLAG_KEY }, 1, 1);
  return parseFeedbackAccess(res.data.length > 0 ? res.data[0].data?.value : undefined);
}

/** Best-effort display identity for the Sheet row: Teams profile name + email, roster role. Any failure
 * or miss → '' fields; identity lookup must NEVER block a session from opening. */
export async function lookupIdentity(me: { name: string | null; email: string | null }): Promise<SessionIdentity> {
  let role = '';
  if (me.email) {
    try {
      role = matchTraderByEmail(me.email, await loadTraders())?.role ?? '';
    } catch {
      // roster unreadable → role-less row; the name and email still land.
    }
  }
  return { name: me.name ?? '', email: me.email ?? '', role };
}

/** Create the session row. Returns the Data row id (the latch value) plus the row as written. */
export async function openSession(
  identity: SessionIdentity,
  channel: string,
  now: number,
): Promise<{ rowId: string; session: FeedbackSessionData }> {
  const session: FeedbackSessionData = {
    session_id: makeSessionId(now),
    ...identity,
    channel,
    status: 'open',
    close_reason: null,
    categories: [],
    message_count: 0,
    feedback_text: '',
    sheet_pushed: false,
    sheet_push_error: null,
    started_at: new Date(now).toISOString(),
    closed_at: null,
  };
  const created = await Data.create(SESSIONS, session, { index: ['status'] });
  return { rowId: created.id, session };
}

/** One verbatim entry per captured message, already categorized. */
export async function appendEntry(entry: FeedbackEntryData): Promise<string> {
  const created = await Data.create(ENTRIES, entry, { index: ['session_id'] });
  return created.id;
}

export async function readSessionRow(rowId: string): Promise<{ rowId: string; session: FeedbackSessionData } | null> {
  try {
    const row = await Data.getEntry(SESSIONS, rowId);
    if (!row?.data) return null;
    return { rowId, session: row.data as FeedbackSessionData };
  } catch {
    return null;
  }
}

export async function updateSessionFull(rowId: string, session: FeedbackSessionData): Promise<void> {
  await Data.update(SESSIONS, rowId, session as unknown as Record<string, unknown>);
}

/** All entries for a session, paged, oldest first. */
export async function collectEntries(sessionId: string): Promise<FeedbackEntryData[]> {
  const out: FeedbackEntryData[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await Data.get(ENTRIES, { session_id: sessionId }, page, 100);
    for (const row of res.data) out.push(row.data as FeedbackEntryData);
    if (res.data.length < 100) break;
  }
  out.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return out;
}

/** Sessions matching a filter, paged. */
export async function pageSessions(filter: LuaQuery): Promise<Array<{ id: string; session: FeedbackSessionData }>> {
  const out: Array<{ id: string; session: FeedbackSessionData }> = [];
  for (let page = 1; page <= 10; page++) {
    const res = await Data.get(SESSIONS, filter, page, 100);
    for (const row of res.data) out.push({ id: row.id, session: row.data as FeedbackSessionData });
    if (res.data.length < 100) break;
  }
  return out;
}

/**
 * The one shared close path (gate expiry, sweeper): mark the session closed with consolidated fields
 * computed from its entries. IDEMPOTENT — an already-closed session is returned unchanged. An entries
 * read blip degrades to closing with whatever the row already holds.
 */
export async function closeSession(
  rowId: string,
  reason: CloseReason,
  now: number,
): Promise<{ rowId: string; session: FeedbackSessionData } | null> {
  const current = await readSessionRow(rowId);
  if (!current) return null;
  if (current.session.status === 'closed') return current;

  let closeFields = {
    feedback_text: current.session.feedback_text,
    categories: current.session.categories,
    message_count: current.session.message_count,
  };
  try {
    closeFields = composeCloseFields(await collectEntries(current.session.session_id));
  } catch {
    // fall back to whatever the row already carries
  }

  const closed: FeedbackSessionData = {
    ...current.session,
    ...closeFields,
    status: 'closed',
    close_reason: reason,
    closed_at: new Date(now).toISOString(),
  };
  await updateSessionFull(rowId, closed);
  return { rowId, session: closed };
}
