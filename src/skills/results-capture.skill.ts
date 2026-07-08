import { LuaSkill } from 'lua-cli';
import RecordResultTool from './tools/RecordResultTool';
import ListAwaitingResultsTool from './tools/ListAwaitingResultsTool';
import SearchSamplesTool from './tools/SearchSamplesTool';

export const resultsCaptureSkill = new LuaSkill({
  name: 'results-capture',
  description: 'Record cupping results and client feedback for Specialty/Bulk samples; list what is awaiting feedback',
  context: `Use when someone shares cupping notes or a client verdict, e.g. "PSS3 cupped 83, citrus driven, clean — approved".
- Resolve the sample with search_samples (by ref text, AWB, or quality+client) to get its tab + id,
  then call record_result with that tab + id.
- Forwarding has no results/cupping step — if a Forwarding parcel is named, say so plainly instead
  of trying to log a result for it.
- Scores/tasting notes go in comments verbatim; result is approved/rejected/pending_feedback.
- "what's awaiting feedback?" -> list_awaiting_results (Specialty + Bulk only; Forwarding never
  reaches a result stage so it's excluded automatically).`,
  tools: [new RecordResultTool(), new ListAwaitingResultsTool(), new SearchSamplesTool()],
});
