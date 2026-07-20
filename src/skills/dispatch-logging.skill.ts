import { LuaSkill } from 'lua-cli';
import FindOpenSamplesTool from './tools/FindOpenSamplesTool';
import RecordDispatchTool from './tools/RecordDispatchTool';

export const dispatchLoggingSkill = new LuaSkill({
  name: 'dispatch-logging',
  description: 'Record that samples were sent out (courier + AWB), across specialty, commercial, and forwarding',
  context: `NO NARRATION — never think out loud to the user: no "Let me check…", "I need to clarify…", "I'm noticing…", "I can offer to…", "before we proceed". Call tools SILENTLY; reply with only the result or the single next question.

Use when QC reports a dispatch, e.g. "dispatched samples to Key coffee tracking details :872526345980 Fedex".
- find_open_samples with the client/receiver/ref text to locate what was pending. It returns each
  hit's tab + id — you need both to record the dispatch on the right table.
- Exactly one plausible match -> record_dispatch on it. Multiple plausible matches or none -> ask ONE
  short question listing the candidates by ref (and tab, if it's ambiguous which book).
- One AWB can cover several rows at once (e.g. a batch of Type samples, or several Forwarding
  parcels under one waybill) — pass every matching {tab, id} in a single record_dispatch call so
  they share the same courier + AWB.
- PHYTO CHECK before it goes out: find_open_samples returns each row's country + phyto_cert. If the
  shipment is leaving Kenya (destination/receiver abroad — every Forwarding parcel qualifies) and
  phyto_cert is empty, ask ONE short question before recording: "Does this shipment need a
  phytosanitary certificate?" Pass the answer as phyto_cert on the record_dispatch call — "Yes" or
  "No"; if they can't say, still record the dispatch and pass "Client to confirm". Never block a
  dispatch on it; if phyto_cert is already filled, don't re-ask.
- Courier words map: DHL->dhl, Fedex->fedex, UPS->ups, Kiptoo/rider->rider, HD/by hand->hand_delivery,
  picked by client->client_pickup — just pass the word as said, the tool normalizes it.
- AWB numbers are normalized to digits-only automatically; pass the number as given.
- Confirm with ref(s) + AWB, then show each dispatched row as a row card + open-link, exactly as the
  persona's write-result format describes — one card per row (a shared AWB still gets one card each).`,
  tools: [new FindOpenSamplesTool(), new RecordDispatchTool()],
});
