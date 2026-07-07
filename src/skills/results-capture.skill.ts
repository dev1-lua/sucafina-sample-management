import { LuaSkill } from 'lua-cli';
import RecordResultTool from './tools/RecordResultTool';
import ListAwaitingResultsTool from './tools/ListAwaitingResultsTool';
import SearchSamplesTool from './tools/SearchSamplesTool';

export const resultsCaptureSkill = new LuaSkill({
  name: 'results-capture',
  description: 'Record cupping results and client feedback; list what is awaiting feedback',
  context: `Use when someone shares cupping notes or a client verdict, e.g. "PSS3 cupped 83, citrus driven, clean — approved".
- Resolve the sample with search_samples (by ref text or quality+client), then record_result.
- Scores/notes go in cupping_notes verbatim; result is approved/rejected/pending_feedback.
- "what's awaiting feedback?" -> list_awaiting_results.`,
  tools: [new RecordResultTool(), new ListAwaitingResultsTool(), new SearchSamplesTool()],
});
