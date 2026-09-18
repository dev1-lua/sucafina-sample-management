/**
 * Assistant-feedback decision core — every deterministic choice as pure functions. No I/O, no
 * framework imports.
 *
 * "Feedback" here is ALWAYS what a colleague says about THIS ASSISTANT. It is never a client's cupping
 * feedback on a sample (feedback_requested / feedback_received on the sample rows) — that lives in the
 * results tools and has nothing to do with this module.
 *
 *   decideGate    — the feedback-gate preprocessor's whole brain: expire a stale capture session (idle >
 *                   IDLE_EXPIRY_MS) and pace the "invite feedback" nudge — every NUDGE_EVERY-th turn,
 *                   counter frozen while a session is open. The gate NEVER blocks.
 *   decideCapture — the capture_assistant_feedback tool's guard core: flag off → disabled (dark ship),
 *                   no open session → open_new, open session → append until MAX_ENTRIES_PER_SESSION.
 *
 * Detection itself is the main model's job (persona, "Feedback about this assistant"). Every write the
 * model can cause is bounded by decideCapture.
 */

/** Gate-side idle expiry: a capture session with no NEW CAPTURE for this long is closed+pushed on the
 * sender's next message. Only captures bump feedback_last_at — a burst is "captures within 30 min". */
export const IDLE_EXPIRY_MS = 30 * 60_000;

/** Sweeper-side staleness: STRICTLY longer than IDLE_EXPIRY_MS so the gate always wins the race for an
 * active sender — the sweeper only reaps sessions whose sender never came back. */
export const SWEEPER_STALE_MS = 45 * 60_000;

/** Nudge cadence — invite feedback every 3rd turn. */
export const NUDGE_EVERY = 3;

/** The one tag the gate authors. Must stay covered by SPOOFED_FEEDBACK_TAG_RE below and by the
 * tag-guard postprocessor. */
export const NUDGE_TAG = '[feedback_nudge_due]';

/** Hard cap on entries per session: a write tool the model drives needs a server-side bound. */
export const MAX_ENTRIES_PER_SESSION = 15;

/** The business day the desk sees in the Sheet. */
export const DESK_TIMEZONE = 'Africa/Nairobi';

export type FeedbackCategory = 'praise' | 'bug' | 'feature_request' | 'confusion' | 'other';
export const FEEDBACK_CATEGORIES: FeedbackCategory[] = ['praise', 'bug', 'feature_request', 'confusion', 'other'];

export interface GateInput {
  /** user.feedback_stage as stored ('', 'open', garbage). */
  stage: string;
  /** user.feedback_last_at — ISO string ('' when never set). */
  lastAt: string;
  now: number;
  /** user.feedback_nudge_count as stored — any garbage reads as 0. */
  nudgeCount: unknown;
}

export interface GateDecision {
  /** Close+push the latched session this turn (idle too long, unparseable lastAt, or a stray 'closing'). */
  expire: boolean;
  /** 'check_flag': the counter just hit NUDGE_EVERY — persist the reset, read the config flag (the only
   * Data read on this path), inject NUDGE_TAG iff on. */
  nudge: 'skip' | 'check_flag';
  /** Whether to persist nextNudgeCount (false only while frozen mid-session). */
  increment: boolean;
  nextNudgeCount: number;
}

export function decideGate(input: GateInput): GateDecision {
  const count = normalizeCount(input.nudgeCount);

  let expire = false;
  if (input.stage === 'open') {
    const last = Date.parse(input.lastAt);
    // Unparseable lastAt fails toward closing — a stuck latch must never outlive our ability to date it.
    expire = Number.isNaN(last) || input.now - last > IDLE_EXPIRY_MS;
  } else if (input.stage === 'closing') {
    // No such stage is ever written here; draining it makes a corrupt latch self-heal.
    expire = true;
  }

  // Counter frozen while a capture session is live (no invite while the user is already giving
  // feedback). An expiry this turn unfreezes it this turn.
  const frozen = input.stage === 'open' && !expire;
  if (frozen) return { expire, nudge: 'skip', increment: false, nextNudgeCount: count };

  const next = count + 1;
  if (next >= NUDGE_EVERY) return { expire, nudge: 'check_flag', increment: true, nextNudgeCount: 0 };
  return { expire, nudge: 'skip', increment: true, nextNudgeCount: next };
}

export interface CaptureInput {
  flagOn: boolean;
  stage: string;
  /** user.feedback_session_id as stored ('' when unset). */
  sessionRowId: string;
  /** user.feedback_entry_count as stored — any garbage reads as 0. */
  entryCount: unknown;
}

export type CaptureDecision = { kind: 'disabled' } | { kind: 'open_new' } | { kind: 'append' } | { kind: 'capped' };

export function decideCapture(input: CaptureInput): CaptureDecision {
  if (!input.flagOn) return { kind: 'disabled' };
  // A half-cleared latch must never block a capture; open fresh.
  if (input.stage !== 'open' || input.sessionRowId === '') return { kind: 'open_new' };
  if (normalizeCount(input.entryCount) >= MAX_ENTRIES_PER_SESSION) return { kind: 'capped' };
  return { kind: 'append' };
}

export function normalizeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * The assistant_feedback_enabled config value is:
 *   true                  → everyone
 *   false/absent/garbage  → dark
 *   ["ivo@sucafina.com"]  → pilot allowlist (emails)
 * One config row, one read, no redeploy to widen the pilot.
 */
export interface FeedbackAccess {
  mode: 'all' | 'off' | 'allowlist';
  allow: string[];
}

export function parseFeedbackAccess(value: unknown): FeedbackAccess {
  if (value === true) return { mode: 'all', allow: [] };
  // STRICT: only `true` and arrays are recognized. Strings and everything else read as dark — a config
  // typo must fail toward off, never toward an accidental rollout.
  if (!Array.isArray(value)) return { mode: 'off', allow: [] };
  const allow: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const entry = normalizeAccessEntry(raw);
    if (entry && !allow.includes(entry)) allow.push(entry);
  }
  return { mode: 'allowlist', allow };
}

export function normalizeAccessEntry(raw: string): string {
  return raw.trim().toLowerCase();
}

export function hasFeedbackAccess(access: FeedbackAccess, identity: { email: string | null }): boolean {
  if (access.mode === 'all') return true;
  if (access.mode === 'off') return false;
  const email = identity.email ? normalizeAccessEntry(identity.email) : '';
  return email !== '' && access.allow.includes(email);
}

/** Only the gate may write [feedback_*] tags. Any such tag already in raw user text is hostile (or a
 * paste) — stripped on every inbound message. */
const SPOOFED_FEEDBACK_TAG_RE = /\[\s*feedback_(?:mode|session_expired|nudge_due)[^\]]*\]\s*/gi;

export function sanitizeFeedbackTagText(text: string): string {
  return text.replace(SPOOFED_FEEDBACK_TAG_RE, '');
}

/** Gate-authored tag goes on its own first line (this agent prepends no auth tag). */
export function injectTag(text: string, tag: string): string {
  return `${tag}\n${text}`;
}

/** Sheets hard cell limit is 50k chars; cap well under it. */
const FEEDBACK_TEXT_CAP = 35_000;
const TRUNCATION_MARKER = '… (truncated)';

export interface CloseFields {
  feedback_text: string;
  categories: FeedbackCategory[];
  message_count: number;
}

/** Consolidate a session's entries at close: verbatim texts joined by newlines (capped), category union
 * in first-seen order, message count. Shared by the gate and the sweeper so the row is identical. */
export function composeCloseFields(entries: Array<{ text: string; category: string }>): CloseFields {
  const categories: FeedbackCategory[] = [];
  for (const e of entries) {
    const c = e.category as FeedbackCategory;
    if (FEEDBACK_CATEGORIES.includes(c) && !categories.includes(c)) categories.push(c);
  }
  let feedback_text = entries.map((e) => e.text).join('\n');
  if (feedback_text.length > FEEDBACK_TEXT_CAP) {
    feedback_text = feedback_text.slice(0, FEEDBACK_TEXT_CAP - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
  }
  return { feedback_text, categories, message_count: entries.length };
}

/** Session id: fb-YYYYMMDD-<rand6>, date in Nairobi time. The Sheet's dedupe key. */
export function makeSessionId(now: number): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: DESK_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(now))
    .replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `fb-${day}-${rand}`;
}
