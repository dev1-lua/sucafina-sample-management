import { PreProcessor, ChatMessage } from 'lua-cli';
import { currentConversation } from '../lib/conversation';
import { identityFromUser } from '../lib/current-user';
import { NUDGE_TAG, decideGate, hasFeedbackAccess, injectTag, sanitizeFeedbackTagText } from '../lib/assistant-feedback/state';
import { readFeedbackAccess } from '../lib/assistant-feedback/store';
import { closeAndPush } from '../lib/assistant-feedback/sheet-push';

/**
 * feedback-gate — housekeeping for the assistant-feedback module. It NEVER blocks and holds no capture
 * logic (the model detects feedback about the assistant and writes it via capture_assistant_feedback).
 * Runs after current-datetime (priority 2 vs 1) and leaves its stamp alone. Three deterministic jobs:
 *
 *   1. STRIP counterfeit [feedback_*] tags from user text — only this gate may author them.
 *   2. EXPIRE a stale capture session: no new capture for >30 min → close the row, push the Sheet
 *      mirror, clear the latch, silently (the user never knew a "session" existed).
 *   3. PACE the invite: count turns on the user record; every NUDGE_EVERY-th turn reset the counter,
 *      read the assistant_feedback_enabled flag (the ONLY Data read on this path) and, if on and this is
 *      a 1:1 chat, put [feedback_nudge_due] on the first line (the persona renders one invite line).
 *
 * Safety: the whole execute is wrapped — any throw degrades to proceed-with-sanitized-messages. Dark
 * until the flag is flipped (the counter still runs, invisibly); expiry is flag-INDEPENDENT so open
 * sessions drain after a flip-off. Latch writes are fail-open: the nightly sweeper (45 min > the gate's
 * 30) reaps whatever the gate misses.
 *
 * Latch = user-record fields, cleared with ''/0, never null: feedback_session_id, feedback_stage
 * (''|'open'), feedback_last_at (ISO — bumped ONLY by captures), feedback_nudge_count,
 * feedback_entry_count.
 */

/** Tighter than the sweeper's 8 s — the sender is waiting on a reply. */
const GATE_PUSH_TIMEOUT_MS = 4_000;

type UserRecord = {
  feedback_session_id?: unknown;
  feedback_stage?: unknown;
  feedback_last_at?: unknown;
  feedback_nudge_count?: unknown;
  update: (fields: Record<string, unknown>) => Promise<unknown>;
};

function mapText(messages: ChatMessage[], fn: (text: string) => string, firstOnly = false): ChatMessage[] {
  let done = false;
  return messages.map((m) => {
    if (m.type !== 'text' || typeof m.text !== 'string' || (firstOnly && done)) return m;
    done = true;
    return { ...m, text: fn(m.text) };
  });
}

function diag(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ diag: 'feedback_gate', ...fields }));
}

const feedbackGate = new PreProcessor({
  name: 'feedback-gate',
  description:
    'Assistant-feedback housekeeping: strips counterfeit [feedback_*] tags from user text, silently closes and mirrors capture sessions idle >30 min, and every 3rd turn injects [feedback_nudge_due] when the assistant_feedback_enabled flag is on. Never blocks.',
  async: false,
  priority: 2,
  execute: async (user, messages, _channel) => {
    const sanitized = mapText(messages, sanitizeFeedbackTagText);
    try {
      const u = user as unknown as UserRecord;
      const stage = typeof u.feedback_stage === 'string' ? u.feedback_stage : '';
      const sessionRowId = typeof u.feedback_session_id === 'string' ? u.feedback_session_id : '';
      const lastAt = typeof u.feedback_last_at === 'string' ? u.feedback_last_at : '';
      const now = Date.now();

      const d = decideGate({ stage, lastAt, now, nudgeCount: u.feedback_nudge_count });

      if (d.expire) {
        if (sessionRowId) {
          const r = await closeAndPush(sessionRowId, 'expired', now, { timeoutMs: GATE_PUSH_TIMEOUT_MS });
          diag({ action: 'expired', session_row: sessionRowId, pushed: r.pushed, error: r.error ?? null });
        } else {
          diag({ action: 'expired_no_row', stage });
        }
        try {
          await u.update({ feedback_session_id: '', feedback_stage: '', feedback_last_at: '', feedback_entry_count: 0 });
        } catch {
          // The stage survives this turn; the expiry branch retries on the next message, and the
          // sweeper closes the row anyway.
        }
      }

      if (d.increment) {
        try {
          await u.update({ feedback_nudge_count: d.nextNudgeCount });
        } catch {
          // cosmetic — pacing precision only
        }
      }

      if (d.nudge === 'check_flag') {
        let allowed = false;
        let mode = 'off';
        try {
          const access = await readFeedbackAccess();
          mode = access.mode;
          allowed = hasFeedbackAccess(access, { email: identityFromUser(user).email });
          // 1:1 chats only — in a Teams group the invite would land on whoever happened to speak.
          if (allowed && (await currentConversation()).isGroup) allowed = false;
        } catch {
          // Config unreadable → dark this turn.
        }
        diag({ action: allowed ? 'nudge_due' : 'nudge_dark', mode });
        if (allowed) {
          return { action: 'proceed', modifiedMessage: mapText(sanitized, (t) => injectTag(t, NUDGE_TAG), true) };
        }
      }

      return { action: 'proceed', modifiedMessage: sanitized };
    } catch (err) {
      // Feedback must never break normal traffic.
      diag({ action: 'gate_error', message: err instanceof Error ? err.message : String(err) });
      return { action: 'proceed', modifiedMessage: sanitized };
    }
  },
});

export default feedbackGate;
