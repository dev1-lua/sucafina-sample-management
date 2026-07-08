import { LuaSkill } from 'lua-cli';
import FindOpenSamplesTool from './tools/FindOpenSamplesTool';
import RecordDispatchTool from './tools/RecordDispatchTool';

export const dispatchLoggingSkill = new LuaSkill({
  name: 'dispatch-logging',
  description: 'Record that samples were sent out (courier + AWB), across specialty, bulk, and forwarding',
  context: `Use when QC reports a dispatch, e.g. "dispatched samples to Key coffee tracking details :872526345980 Fedex".
- find_open_samples with the client/receiver/ref text to locate what was pending. It returns each
  hit's tab + id — you need both to record the dispatch on the right table.
- Exactly one plausible match -> record_dispatch on it. Multiple plausible matches or none -> ask ONE
  short question listing the candidates by ref (and tab, if it's ambiguous which book).
- One AWB can cover several rows at once (e.g. a batch of Type samples, or several Forwarding
  parcels under one waybill) — pass every matching {tab, id} in a single record_dispatch call so
  they share the same courier + AWB.
- Courier words map: DHL->dhl, Fedex->fedex, UPS->ups, Kiptoo/rider->rider, HD/by hand->hand_delivery,
  picked by client->client_pickup — just pass the word as said, the tool normalizes it.
- AWB numbers are normalized to digits-only automatically; pass the number as given.
- Confirm with ref(s) + AWB in one line, then put each row's dashboard url on its own line (one "ref -> url" per row).`,
  tools: [new FindOpenSamplesTool(), new RecordDispatchTool()],
});
