import { LuaTool, User } from 'lua-cli';
import { z } from 'zod';
import { currentConversation } from '../../lib/conversation';
import { identityFromUser } from '../../lib/current-user';
import {
  FEEDBACK_CATEGORIES,
  MAX_ENTRIES_PER_SESSION,
  decideCapture,
  hasFeedbackAccess,
  normalizeCount,
  type FeedbackCategory,
} from '../../lib/assistant-feedback/state';
import { appendEntry, lookupIdentity, openSession, readFeedbackAccess, readSessionRow, type FeedbackSessionData } from '../../lib/assistant-feedback/store';
import { buildSheetPayload, pushSessionToSheet } from '../../lib/assistant-feedback/sheet-push';

// The ONE LLM-facing write in the assistant-feedback module. A registered write tool WILL fire
// conversationally in ways the persona did not intend, so the blast radius is bounded here, not there:
//   - every path is decided by the pure decideCapture core: flag off → 'disabled' (dark ship — the diag
//     line is the dark-probe signal), open session → append, MAX_ENTRIES_PER_SESSION → 'capped';
//   - it can only CREATE entries in the caller's own session — never read, update or delete anything else;
//   - identity comes from the caller's Teams profile, never from message text;
//   - 1:1 chats only: in a Teams group the bot cannot tell who is speaking;
//   - any failure degrades to a quiet {status:'error'} and the conversation continues undisturbed.

/** The sender is waiting on a reply — a slow Sheet must not hold it up. A miss is repaired at close. */
const LIVE_PUSH_TIMEOUT_MS = 4_000;

/** Whatever happens, the model is told to keep the conversation normal and never surface the machinery. */
const NOTE_SILENT = 'Continue the conversation normally. Never mention feedback capture or this tool.';

function diag(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ diag: 'capture_feedback', ...fields }));
}

type SelfRecord = {
  feedback_stage?: unknown;
  feedback_session_id?: unknown;
  feedback_entry_count?: unknown;
  update: (fields: Record<string, unknown>) => Promise<unknown>;
};

export default class CaptureAssistantFeedbackTool implements LuaTool {
  name = 'capture_assistant_feedback';
  description =
    "Record what the user says ABOUT THIS ASSISTANT — praise, a wrong or confusing answer BY the assistant, something it could not do, a feature ask — verbatim, in their own words. NEVER for a CLIENT's feedback or cupping result on a sample (that is sample data — use the results tools), never for a wrong AWB / status / ref / date on a record (a data question — look it up or fix it), never for complaints about a courier, the lab or a client. Call at most once per user message, only as the persona's \"Feedback about this assistant\" section says. Returns { status, first_capture, note } — the note says how to reply.";

  inputSchema = z.object({
    feedback_text: z
      .string()
      .min(3)
      .max(1500)
      .describe("The user's feedback VERBATIM — their words, their language. Never a summary, never a translation."),
    category: z
      .enum(FEEDBACK_CATEGORIES as [FeedbackCategory, ...FeedbackCategory[]])
      .describe('Best-fit category: praise | bug | feature_request | confusion | other.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    try {
      // Outside the Lua runtime (the local harnesses) there is no chatting user to attribute to.
      if (process.env.LUA_LOCAL_HARNESS === '1') return { status: 'unavailable', note: NOTE_SILENT };

      let self: SelfRecord | null = null;
      try {
        self = (await User.get()) as SelfRecord | null;
      } catch {
        self = null;
      }
      if (!self || typeof self.update !== 'function') {
        diag({ action: 'unavailable' });
        return { status: 'unavailable', note: NOTE_SILENT };
      }
      const me = identityFromUser(self);

      const conversation = await currentConversation();
      if (conversation.isGroup) {
        diag({ action: 'disabled_group' });
        return { status: 'disabled', note: NOTE_SILENT };
      }

      let flagOn = false;
      let accessMode = 'off';
      try {
        const access = await readFeedbackAccess();
        accessMode = access.mode;
        flagOn = hasFeedbackAccess(access, { email: me.email });
      } catch {
        // Config unreadable → dark this call.
      }

      const stage = typeof self.feedback_stage === 'string' ? self.feedback_stage : '';
      const sessionRowId = typeof self.feedback_session_id === 'string' ? self.feedback_session_id : '';
      const decision = decideCapture({ flagOn, stage, sessionRowId, entryCount: self.feedback_entry_count });

      if (decision.kind === 'disabled') {
        // The dark-probe signal: proves the model detected + called while the flag kept it invisible.
        diag({ action: 'disabled_dark', category: input.category, mode: accessMode });
        return { status: 'disabled', note: NOTE_SILENT };
      }
      if (decision.kind === 'capped') {
        diag({ action: 'capped', session_row: sessionRowId, cap: MAX_ENTRIES_PER_SESSION });
        return {
          status: 'capped',
          first_capture: false,
          note: `Thank the user in one brief line. Do not call this tool again this session. ${NOTE_SILENT}`,
        };
      }

      const now = Date.now();
      const nowIso = new Date(now).toISOString();

      let firstCapture: boolean;
      let rowId: string;
      let sessionId: string;
      let entryCount: number;
      let sessionData: FeedbackSessionData;

      const existing = decision.kind === 'append' ? await readSessionRow(sessionRowId) : null;
      if (existing && existing.session.status === 'open') {
        firstCapture = false;
        rowId = existing.rowId;
        sessionId = existing.session.session_id;
        sessionData = existing.session;
        entryCount = normalizeCount(self.feedback_entry_count) + 1;
      } else {
        // open_new — or an 'append' whose session row vanished or was already swept (self-heal by
        // opening fresh; the orphaned latch is overwritten below).
        firstCapture = true;
        const opened = await openSession(await lookupIdentity(me), conversation.channel ?? 'chat', now);
        rowId = opened.rowId;
        sessionId = opened.session.session_id;
        sessionData = opened.session;
        entryCount = 1;
      }

      const entryId = await appendEntry({
        session_id: sessionId,
        text: input.feedback_text,
        category: input.category,
        email: me.email ?? '',
        created_at: nowIso,
      });

      // Mirror this entry to the Sheet NOW (never throws). A failure costs nothing: the session row stays
      // sheet_pushed:false and the close push (gate / sweeper) appends whatever is missing.
      const live = await pushSessionToSheet(
        buildSheetPayload(sessionData, [{ id: entryId, text: input.feedback_text, category: input.category, created_at: nowIso }]),
        { timeoutMs: LIVE_PUSH_TIMEOUT_MS },
      );

      // Latch stamps are fail-open: the entry is saved; a failed stamp only costs burst-grouping
      // precision (the next capture opens a new session).
      try {
        await self.update({
          feedback_session_id: rowId,
          feedback_stage: 'open',
          feedback_last_at: nowIso,
          feedback_entry_count: entryCount,
        });
      } catch {
        // cosmetic
      }

      diag({ action: firstCapture ? 'open_capture' : 'append_capture', session_id: sessionId, entry_id: entryId, category: input.category, sheet: live.ok ? 'pushed' : (live.error ?? 'failed') });
      return {
        status: 'captured',
        first_capture: firstCapture,
        note: firstCapture
          ? `Answer any real question in the message first, then close with ONE short open follow-up, in the user's language, about what would make this assistant more useful. Acknowledge in a few words at most — never promise a fix, a timeline, or that you will behave differently ("I'll be more careful"). ${NOTE_SILENT}`
          : `One brief line of thanks, no second follow-up question. ${NOTE_SILENT}`,
      };
    } catch (err) {
      // Opportunistic capture must never derail the answer.
      diag({ action: 'capture_error', message: err instanceof Error ? err.message : String(err) });
      return { status: 'error', note: NOTE_SILENT };
    }
  }
}
