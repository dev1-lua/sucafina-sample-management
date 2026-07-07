import { LuaSkill } from 'lua-cli';
import FindOpenSamplesTool from './tools/FindOpenSamplesTool';
import RecordDispatchTool from './tools/RecordDispatchTool';

export const dispatchLoggingSkill = new LuaSkill({
  name: 'dispatch-logging',
  description: 'Record that samples were sent out (courier + AWB)',
  context: `Use when QC reports a dispatch, e.g. "dispatched samples to Key coffee tracking details :872526345980 Fedex".
- find_open_samples with the client name to locate what was pending.
- Exactly one plausible set -> record_dispatch on all of them. Multiple plausible sets or none -> ask ONE short question listing the candidates by ref.
- Courier words map: DHL->dhl, Fedex->fedex, UPS->ups, Kiptoo/rider->rider, HD/by hand->hand_delivery, picked by client->client_pickup.
- Confirm with refs + AWB in one line.`,
  tools: [new FindOpenSamplesTool(), new RecordDispatchTool()],
});
