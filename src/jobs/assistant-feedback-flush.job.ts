import { LuaJob } from 'lua-cli';
import { SWEEPER_STALE_MS } from '../lib/assistant-feedback/state';
import { collectEntries, pageSessions, updateSessionFull, type FeedbackSessionData } from '../lib/assistant-feedback/store';
import { buildSheetPayload, closeAndPush, pushSessionToSheet } from '../lib/assistant-feedback/sheet-push';

// Nightly sweeper for the assistant-feedback module. The feedback-gate closes sessions inline when the
// sender comes back (30-min expiry); this is the BACKSTOP for the two cases the gate cannot cover:
//   1. abandoned sessions — the sender gave feedback and never returned, so nothing triggers the gate;
//   2. failed Sheet pushes — webhook outage / wrong secret / env unset left closed rows unpushed.
// 45 min staleness is deliberately LONGER than the gate's 30 so the gate always wins for an active
// sender. It cannot clear user-record latches (no user in a job) and doesn't need to: the gate's expiry
// branch self-heals the latch on the sender's next message, and closeSession is idempotent.
// Runs regardless of the assistant_feedback_enabled flag — it must drain sessions opened before a
// flip-off. With no sessions it is a couple of empty reads. No LLM on this path.

const SWEEPER_PUSH_TIMEOUT_MS = 8_000;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function runAssistantFeedbackFlush(now: number = Date.now()) {
  let swept = 0;
  let pushed = 0;
  let failed = 0;
  const details: Array<Record<string, unknown>> = [];

  // 1. Reap abandoned open sessions.
  let open: Array<{ id: string; session: FeedbackSessionData }> = [];
  try {
    open = await pageSessions({ status: 'open' });
  } catch (err) {
    failed++;
    details.push({ step: 'page_open', error: message(err) });
  }
  for (const { id, session } of open) {
    try {
      // Last activity = newest entry, else session start.
      let lastAt = Date.parse(session.started_at);
      try {
        const entries = await collectEntries(session.session_id);
        const t = Date.parse(String(entries[entries.length - 1]?.created_at));
        if (!Number.isNaN(t)) lastAt = Number.isNaN(lastAt) ? t : Math.max(lastAt, t);
      } catch {
        // entries unreadable → sweep on started_at alone
      }
      if (Number.isNaN(lastAt) || now - lastAt > SWEEPER_STALE_MS) {
        const r = await closeAndPush(id, 'swept', now, { timeoutMs: SWEEPER_PUSH_TIMEOUT_MS });
        swept++;
        if (r.pushed) pushed++;
        details.push({ step: 'sweep', session_id: session.session_id, pushed: r.pushed, error: r.error ?? null });
      }
    } catch (err) {
      failed++;
      details.push({ step: 'sweep', session_id: session.session_id, error: message(err) });
    }
  }

  // 2. Retry failed pushes on already-closed sessions.
  let unpushed: Array<{ id: string; session: FeedbackSessionData }> = [];
  try {
    unpushed = await pageSessions({ status: 'closed', sheet_pushed: false });
  } catch (err) {
    failed++;
    details.push({ step: 'page_unpushed', error: message(err) });
  }
  let notConfiguredLogged = false;
  for (const { id, session } of unpushed) {
    try {
      const entries = await collectEntries(session.session_id);
      if (entries.length === 0) {
        // Nothing to mirror — mark pushed so the row stops re-queuing nightly.
        await updateSessionFull(id, { ...session, sheet_pushed: true, sheet_push_error: null });
        details.push({ step: 'retry_push', session_id: session.session_id, note: 'no_entries' });
        continue;
      }
      const result = await pushSessionToSheet(buildSheetPayload(session, entries), { timeoutMs: SWEEPER_PUSH_TIMEOUT_MS });
      if (result.ok) {
        pushed++;
        await updateSessionFull(id, { ...session, sheet_pushed: true, sheet_push_error: null });
        details.push({ step: 'retry_push', session_id: session.session_id, dedup: result.dedup ?? false });
      } else if (result.error === 'not_configured') {
        // Env not set — expected before Sheet go-live; say so once per run and leave the rows queued.
        if (!notConfiguredLogged) {
          notConfiguredLogged = true;
          details.push({ step: 'retry_push', note: 'sheet env not configured — leaving rows for a later run' });
        }
      } else {
        failed++;
        await updateSessionFull(id, { ...session, sheet_push_error: result.error ?? 'unknown' });
        details.push({ step: 'retry_push', session_id: session.session_id, error: result.error ?? 'unknown' });
      }
    } catch (err) {
      failed++;
      details.push({ step: 'retry_push', session_id: session.session_id, error: message(err) });
    }
  }

  const outcome = { success: true, swept, pushed, failed, details };
  console.log(`[assistant-feedback-flush] ${JSON.stringify(outcome)}`);
  return outcome;
}

export const assistantFeedbackFlushJob = new LuaJob({
  name: 'assistant-feedback-flush',
  description:
    'Nightly: close assistant-feedback capture sessions abandoned for more than 45 minutes and retry failed Google Sheet pushes. Backstop for the feedback-gate preprocessor; idempotent; no LLM',
  schedule: { type: 'cron', expression: '45 21 * * *', timezone: 'Africa/Nairobi' },
  execute: async () => runAssistantFeedbackFlush(),
});
