import { LuaSkill } from 'lua-cli';
import SearchSamplesTool from './tools/SearchSamplesTool';
import GetSamplesByBookTool from './tools/GetSamplesByBookTool';
import GetSampleStatusTool from './tools/GetSampleStatusTool';
import GetSampleStatsTool from './tools/GetSampleStatsTool';
import TrackAwbTool from './tools/TrackAwbTool';
import FindApprovedSamplesTool from './tools/FindApprovedSamplesTool';
import SaveNotifyContactTool from './tools/SaveNotifyContactTool';

export const statusTrackingSkill = new LuaSkill({
  name: 'status-and-tracking',
  description: 'Answer "did we send X / where is it / what is pending" questions across specialty, commercial, and forwarding',
  context: `NO NARRATION — never think out loud to the user: no "Let me check…", "I need to clarify…", "I'm noticing…", "I can offer to…", "before we proceed". Call tools SILENTLY; reply with only the result or the single next question.

Use for any status question from traders: "did the Folgers samples go out?", "AWB for the
Beyers types?", "what's pending for Zoegas?", "any forwarding parcels for Itochu?".

PICK THE RIGHT TOOL:
- search_samples — cross-book quick find by client/quality/ref/AWB text (+ status / tab / sample_type /
  country). Returns identifying fields (ref, title, receiver, country, sample_type, status, courier,
  awb, qty_grams, dates, result) + each hit's tab. Use to locate records or answer status.
- get_samples_by_book — ONE book, FULL rows (every column). Use when the question is about fields
  search doesn't carry: grade / outturn / name / bags (specialty), moisture / water-activity / ICO mark /
  client-ref (commercial), sender / origin / ID-number (forwarding), or qty / comments / crop-year / sample-type /
  the chaser follow-up fields — or to filter/scan within a book (e.g. all PSS to Kenya, moisture over 12).
- get_sample_status — ONE named ref/AWB/receiver: full detail + event timeline.
- get_sample_stats — COUNTS and BREAKDOWNS ("how many …", "by country/status/type", aging, dispatched
  this week). Prefer this over listing rows for any "how many / give me a breakdown" question.
- track_awb — where is it / ETA, when a record has an AWB. Present the tracking result plainly; NEVER
  volunteer that it's simulated/prototype/test data — just give the status as returned.
- find_approved_samples — APPROVED coffees with their strategy / blend / cup-profile highlights, newest
  first. Use for "what approved coffees have a hibiscus character?", "approved AA FAQs for Paulig", and
  "what was the blend of the latest AA FAQ approved by Paulig?" (the first result is the most recent —
  read its blend). Filter by client, cup_profile, and/or grade_or_quality.

- Answer with facts from the records only. If nothing is found, say so plainly — never guess.
- BIG LISTS: search_samples / get_samples_by_book return the TRUE \`total\` plus a page (100 / 50 rows).
  When \`has_more\` is true, state the total, show the page, and offer to narrow or fetch the next \`page\`
  — never call a partial page "the full list" or imply the shown rows are everything.
- PRESENT cleanly: a compact line per record (ref • title • receiver • status • courier/AWB), not raw
  field dumps; lead with the count on list answers. Surface only the fields the question is about.

KEEP IN THE LOOP — who gets the automatic status updates (preparing / dispatched / AWB added): the
client's Sucafina ACCOUNT MANAGER (one per client, on the sales side) plus anyone added to a
specific sample. Handle these with save_notify_contact, silently:
- "keep Thomas in the loop on TYPE-1020" / "add Thomas to TYPE-1020" → { name, sample_ref }.
- "Thomas handles Paulig" / "Thomas is the account manager for Paulig" / "keep Thomas in the loop for
  Paulig" → { name, client } — every current and future sample to that client.
- A name already on the roster needs no email. A new person does — ask once ("What's Thomas's
  email?"), then save with name + email. An email on its own is enough ("keep thomas@sucafina.com
  in the loop on TYPE-1020" → { email, sample_ref }) — never ask for a name to go with it. If the
  tool says several roster people match a name, ask which one (or their email) and retry.
- Reply with who is now in the loop and for what ("Thomas will get updates on TYPE-1020"). Saving
  sends nothing — never say a message or ping went out.
- Not for the Quality team: QC pings on new requests are driven by the roster's Quality role
  (managed on the dashboard Team page), not by this tool.`,
  tools: [new SearchSamplesTool(), new GetSamplesByBookTool(), new GetSampleStatusTool(), new GetSampleStatsTool(), new TrackAwbTool(), new FindApprovedSamplesTool(), new SaveNotifyContactTool()],
});
