import { LuaSkill } from 'lua-cli';
import CreateConsignmentTool from './tools/CreateConsignmentTool';
import AddSamplesToConsignmentTool from './tools/AddSamplesToConsignmentTool';
import SetConsignmentLocationTool from './tools/SetConsignmentLocationTool';
import ListConsignmentsTool from './tools/ListConsignmentsTool';
import GetConsignmentTool from './tools/GetConsignmentTool';

export const consignmentsSkill = new LuaSkill({
  name: 'consignments',
  description: 'Group samples into consignments (with a generated CN number), assign them to a lab location, and view what is grouped',
  context: `NO NARRATION — never think out loud to the user: no "Let me check…", "I need to…". Call tools SILENTLY; reply with only the result or the single next question.

A consignment is an ORDER: the samples of one request to one client, shipping out together. It carries a
desk-issued number (CN-####), the client, the Sales Trader and who logged it, and a lab location
(Westlands / Thika). Use when the team says things like "group these into a consignment", "put SL-8000
and SL-8001 together for Thika", "which samples are in CN-1004?", "what's the status of CN-1012?".

- Create one with create_consignment — pass samples [{tab, id}] (from create / search results) or refs
  [], plus client_id and requested_by / logged_by when known. The number is auto-generated — never
  invent one; report the one that comes back. (The intake skill does this itself for a multi-coffee
  request — see its ORDERS block.)
- Add more samples later with add_samples_to_consignment ({tab, id} or refs). A ref names the COFFEE
  and can have several sends: pass receiver to pick one. Anything that doesn't resolve comes back in
  \`unresolved_refs\` with the reason in \`unresolved\` — tell the user which and why (e.g. "SL-7336 has 2
  sends — which receiver?"), don't silently drop it.
- Assign / change the lab with set_consignment_location; mark it dispatched/closed via the same tool's status.
- A whole order going out under one AWB: record_dispatch { consignment: "CN-1012", courier, awb } — every
  live sample in it is marked dispatched in one go (dispatch-logging skill).
- "what's in <CN>?" -> get_consignment (members + derived status: requested / partly dispatched /
  dispatched / delivered / closed). "show consignments" -> list_consignments.
- Location is Westlands or Thika. A sample can belong to at most one consignment; adding it to a new
  one moves it.`,
  tools: [
    new CreateConsignmentTool(),
    new AddSamplesToConsignmentTool(),
    new SetConsignmentLocationTool(),
    new ListConsignmentsTool(),
    new GetConsignmentTool(),
  ],
});
