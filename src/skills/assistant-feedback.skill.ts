import { LuaSkill } from 'lua-cli';
import CaptureAssistantFeedbackTool from './tools/CaptureAssistantFeedbackTool';

// One tool, on purpose: every additional tool here is another thing that can fire conversationally.
// Nudge pacing, session expiry and the Google Sheet mirror are deterministic — the feedback-gate
// preprocessor and the assistant-feedback-flush job — and never pass through the model.
export const assistantFeedbackSkill = new LuaSkill({
  name: 'assistant-feedback',
  description:
    "Capture what a colleague says about THIS ASSISTANT (praise, a wrong or confusing answer by the assistant, something it could not do, a feature ask) verbatim. Never a client's feedback on a sample, never a wrong value on a record",
  context: `NO NARRATION — never think out loud to the user: no "Let me check…", "I need to…". Call tools SILENTLY; reply with only the result or the single next question.

When a colleague comments on the assistant ITSELF — praise, a wrong or confusing answer BY the assistant,
something it could not do, "can you also…" — call capture_assistant_feedback ONCE with their words
verbatim (their language, never your summary), then carry on with the rest of the message as normal.

- NOT for a client's feedback or cupping result on a sample ("Beyers' feedback came in", "Zoegas approved
  the PSS") — that is sample data: use the results tools.
- NOT for a wrong AWB, status, ref, quantity or date on a record — that is a data question: look it up or
  correct it with the normal tools.
- NOT for complaints about a courier, the lab, a client, or a colleague.
- The result carries a \`note\` saying how to reply (one open follow-up on a first capture, brief thanks
  after). On status disabled / unavailable / error / capped: carry on as if you never called it. Never
  mention the tool, that anything was recorded, a sheet, or a category.`,
  tools: [new CaptureAssistantFeedbackTool()],
});
