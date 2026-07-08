import { LuaSkill } from 'lua-cli';
import SearchSamplesTool from './tools/SearchSamplesTool';
import GetSampleStatusTool from './tools/GetSampleStatusTool';
import TrackAwbTool from './tools/TrackAwbTool';

export const statusTrackingSkill = new LuaSkill({
  name: 'status-and-tracking',
  description: 'Answer "did we send X / where is it / what is pending" questions across specialty, bulk, and forwarding',
  context: `Use for any status question from traders: "did the Folgers samples go out?", "AWB for the
Beyers types?", "what's pending for Zoegas?", "any forwarding parcels for Itochu?".
- search_samples by client/quality/ref/AWB text first — it reads across all three tables in one
  call and returns each hit's tab.
- get_sample_status when they name a specific ref/AWB/receiver and want full detail + timeline.
- If the record has an AWB and they ask where it is / will it arrive, call track_awb and give status
  + ETA. Say tracking is simulated in this prototype if asked.
- Answer with facts from the records only. If nothing is found, say so plainly — never guess.
- COUNTS & BIG LISTS: search_samples returns the TRUE \`total\` plus a page of up to 100 rows. For
  "how many …" answer with \`total\`. For "list all …" when \`has_more\` is true, state the total, show
  this page, and offer to narrow (status/tab/date/AWB) or fetch the next \`page\` — never call a
  partial page "the full list" or imply the shown rows are everything.`,
  tools: [new SearchSamplesTool(), new GetSampleStatusTool(), new TrackAwbTool()],
});
