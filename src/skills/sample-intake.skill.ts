import { LuaSkill } from 'lua-cli';
import FindClientTool from './tools/FindClientTool';
import CreateSampleRequestTool from './tools/CreateSampleRequestTool';

export const sampleIntakeSkill = new LuaSkill({
  name: 'sample-intake',
  description: 'Log new sample requests from traders',
  context: `Use when a trader asks to send/prepare samples for a client.
- Each distinct quality = one sample record. "AB FAQ, ABC FAQ and Heavy Mbuni to Beyers" = 3 records.
- ALWAYS call find_client first to resolve the company (use the company, not the person: "Thomas at Beyers" -> search "beyers"). Pass client_id when exactly one match; otherwise pass receiver as stated and mention you could not resolve the client.
- Required before creating: quality + sample type + receiver. If the sample type is unclear, ask ONE short question (e.g. "as Types?"). Do not ask about anything else — qty defaults by type (offer 200g, type 300g, PSS 1kg), deadline and roast instructions are optional.
- After creating, confirm compactly: one line per sample with ref, quality, qty, receiver, deadline.`,
  tools: [new FindClientTool(), new CreateSampleRequestTool()],
});
