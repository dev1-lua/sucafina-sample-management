import { LuaSkill } from 'lua-cli';
import SearchSamplesTool from './tools/SearchSamplesTool';
import GetSampleStatusTool from './tools/GetSampleStatusTool';
import TrackAwbTool from './tools/TrackAwbTool';

export const statusTrackingSkill = new LuaSkill({
  name: 'status-and-tracking',
  description: 'Answer "did we send X / where is it / what is pending" questions',
  context: `Use for any status question from traders: "did the Folgers samples go out?", "AWB for the Beyers types?", "what's pending for Zoegas?".
- search_samples by client/quality text first; get_sample_status when they name a specific ref.
- If the record has an AWB and they ask where it is / will it arrive, call track_awb and give status + ETA. Say tracking is simulated in this prototype if asked.
- Answer with facts from the records only. If nothing is found, say so plainly — never guess.`,
  tools: [new SearchSamplesTool(), new GetSampleStatusTool(), new TrackAwbTool()],
});
