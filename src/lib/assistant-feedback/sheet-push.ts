/**
 * Google Sheet mirror for closed assistant-feedback sessions — ONE SHEET ROW PER ENTRY.
 *
 * The Sheet is a MIRROR, never the record: the Data collections are authoritative, and a failed push
 * just leaves sheet_pushed:false for the nightly sweeper to retry. Transport is a Google Apps Script web
 * app (docs/assistant-feedback-sheet.md): verify shared secret → dedupe on the session_id column → one
 * appended row per entry → {ok:true, appended:n}.
 *
 * Each entry is pushed the moment it is captured (the tool), and the whole session is pushed again when
 * it closes (gate / sweeper). The script dedupes PER ENTRY on entry_id and appends only what is missing,
 * so every push is idempotent: the close push is a no-op when the live pushes landed, and the repair when
 * one did not. sheet_pushed on the session row means "every entry is known to be in the Sheet".
 *
 * Env (unset → not_configured; the push is skipped and retried once configured):
 *   FEEDBACK_SHEET_WEBHOOK_URL  the /exec web-app URL
 *   FEEDBACK_SHEET_SECRET       shared secret; POST body only, NEVER logged
 *
 * Apps Script gotchas encoded here:
 *   - web apps 302-redirect to a googleusercontent host → redirect:'follow'
 *   - error pages come back HTTP 200 as HTML → success requires the body to PARSE as JSON with
 *     ok === true, not just a 2xx status
 */
import { env } from 'lua-cli';
import { DESK_TIMEZONE } from './state';
import { closeSession, collectEntries, updateSessionFull, type CloseReason, type FeedbackSessionData } from './store';

export interface SheetEntryPayload {
  /** The entry's Data row id — the Sheet's per-entry dedupe key. */
  id: string;
  date: string; // capture date, Nairobi time
  time: string; // capture time HH:mm, Nairobi time
  category: string;
  feedback: string;
}

export interface SheetPayload {
  session_id: string;
  name: string;
  email: string;
  role: string;
  channel: string;
  entries: SheetEntryPayload[];
}

const DESK_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: DESK_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const DESK_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: DESK_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23', // midnight renders 00:xx, never 24:xx
});

// Intl.format(new Date(NaN)) THROWS — guard so the builder stays total.
function deskDate(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : DESK_DATE.format(t);
}

function deskTime(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : DESK_TIME.format(t);
}

/** Pure payload composer — one element of `entries` per sheet row, in the order given. No secret here:
 * the caller injects it at POST time only, so the payload can safely be logged. */
export function buildSheetPayload(
  session: Pick<FeedbackSessionData, 'session_id' | 'name' | 'email' | 'role' | 'channel'>,
  entries: Array<{ id?: string; text: string; category: string; created_at: string }>,
): SheetPayload {
  return {
    session_id: session.session_id,
    name: session.name ?? '',
    email: session.email ?? '',
    role: session.role ?? '',
    channel: session.channel ?? '',
    entries: entries.map((e) => ({
      id: e.id ?? '',
      date: deskDate(String(e.created_at)),
      time: deskTime(String(e.created_at)),
      category: e.category,
      feedback: e.text,
    })),
  };
}

export interface SheetPushResult {
  ok: boolean;
  dedup?: boolean;
  error?: string;
}

/** Pure response judge — see the Apps Script gotchas in the header. */
export function interpretSheetResponse(status: number, bodyText: string): SheetPushResult {
  if (status < 200 || status >= 300) return { ok: false, error: `http_${status}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { ok: false, error: 'non_json_response' };
  }
  const obj = parsed as { ok?: unknown; dedup?: unknown; error?: unknown } | null;
  if (obj?.ok === true) return { ok: true, dedup: obj.dedup === true };
  return { ok: false, error: typeof obj?.error === 'string' ? `script_error: ${obj.error}` : 'ok_not_true' };
}

function setting(key: string): string {
  let v: string | undefined;
  try {
    v = env(key);
  } catch {
    v = undefined;
  }
  return v || process.env[key] || '';
}

/** POST one closed session (all its entries) to the Apps Script. Never throws. */
export async function pushSessionToSheet(payload: SheetPayload, opts: { timeoutMs: number }): Promise<SheetPushResult> {
  const url = setting('FEEDBACK_SHEET_WEBHOOK_URL');
  const secret = setting('FEEDBACK_SHEET_SECRET');
  if (!url || !secret) return { ok: false, error: 'not_configured' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, ...payload }),
      redirect: 'follow',
      signal: controller.signal,
    });
    return interpretSheetResponse(res.status, await res.text());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The one shared close-and-mirror path (gate expiry, sweeper): idempotently close the session, read its
 * entries, then best-effort push and record the outcome on the row. Each side effect individually
 * guarded — a push failure leaves sheet_pushed:false for the sweeper; a zero-entry session has nothing
 * to mirror and is marked pushed; a marker-write failure at worst causes one dedup'd retry. Never throws.
 */
export async function closeAndPush(
  rowId: string,
  reason: CloseReason,
  now: number,
  opts: { timeoutMs: number },
): Promise<{ closed: boolean; pushed: boolean; error?: string }> {
  let closedRow: Awaited<ReturnType<typeof closeSession>> = null;
  try {
    closedRow = await closeSession(rowId, reason, now);
  } catch (err) {
    return { closed: false, pushed: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!closedRow) return { closed: false, pushed: false, error: 'session_row_missing' };
  if (closedRow.session.sheet_pushed) return { closed: true, pushed: true };

  let result: SheetPushResult;
  try {
    const entries = await collectEntries(closedRow.session.session_id);
    result = entries.length === 0 ? { ok: true } : await pushSessionToSheet(buildSheetPayload(closedRow.session, entries), opts);
  } catch {
    result = { ok: false, error: 'entries_unreadable' };
  }
  try {
    await updateSessionFull(rowId, {
      ...closedRow.session,
      sheet_pushed: result.ok,
      sheet_push_error: result.ok ? null : (result.error ?? 'unknown'),
    });
  } catch {
    // Marker write failed — the sweeper re-pushes and the Apps Script dedupe absorbs the duplicate.
  }
  return { closed: true, pushed: result.ok, error: result.ok ? undefined : result.error };
}
