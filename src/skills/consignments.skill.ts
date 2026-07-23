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

A consignment groups several samples that ship out together. It carries an auto-generated number
(CN-####) and a lab location (Westlands / Thika). Use when the team says things like "group these
into a consignment", "put SL-8000 and SL-8001 together for Thika", "which samples are in CN-1004?".

- Create one with create_consignment (optionally pass sample_refs to group them immediately, and a
  location). The number is auto-generated — never invent one; report the one that comes back.
- Add more samples later with add_samples_to_consignment (resolves each ref across all three books).
  If any ref doesn't resolve it comes back in \`unresolved_refs\` — tell the user which, don't silently drop it.
- Assign / change the lab with set_consignment_location; mark it dispatched/closed via the same tool's status.
- "what's in <CN>?" -> get_consignment (lists the member samples). "show consignments" -> list_consignments.
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
