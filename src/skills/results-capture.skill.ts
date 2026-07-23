import { LuaSkill } from 'lua-cli';
import RecordResultTool from './tools/RecordResultTool';
import ListAwaitingResultsTool from './tools/ListAwaitingResultsTool';
import SearchSamplesTool from './tools/SearchSamplesTool';

export const resultsCaptureSkill = new LuaSkill({
  name: 'results-capture',
  description: 'Record cupping results and client feedback for Specialty/Commercial samples; list what is awaiting feedback',
  context: `NO NARRATION — never think out loud to the user: no "Let me check…", "I need to clarify…", "I'm noticing…", "I can offer to…", "before we proceed". Call tools SILENTLY; reply with only the result or the single next question.

Use when someone shares cupping notes or a client verdict, e.g. "PSS3 cupped 83, citrus driven, clean — approved".
- Resolve the sample with search_samples (by ref text, AWB, or quality+client) to get its tab + id,
  then call record_result with that tab + id.
- Forwarding has no results/cupping step — if a Forwarding parcel is named, say so plainly instead
  of trying to log a result for it.
- Scores/tasting notes go in comments verbatim; result is approved/rejected/pending_feedback.
- On a REJECTION, capture the reason in \`rejection_reason\` (e.g. "moldy, inconsistent cup", "quakers")
  in addition to the verbatim notes in \`comments\` — it drives the dashboard's rejection tracking.
- "what's awaiting feedback?" -> list_awaiting_results. Its \`total\` is the TRUE count of everything
  awaiting a result; \`samples\` is just the first page. Answer "how many" with \`total\`, and when
  \`has_more\` is true, offer oldest-first or a client filter rather than implying the examples are all.`,
  tools: [new RecordResultTool(), new ListAwaitingResultsTool(), new SearchSamplesTool()],
});
