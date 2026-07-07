import { LuaSkill } from 'lua-cli';
import FindClientTool from './tools/FindClientTool';
import UpsertClientTool from './tools/UpsertClientTool';

export const clientBookSkill = new LuaSkill({
  name: 'client-book',
  description: 'Look up and maintain the client address book',
  context: `Use for "what's X's address", "add new client Y", "update Z's contact".
- find_client for lookups; upsert_client to add a company or attach a new contact/address.
- When reading back an address, give attention_to + full_address + phone in one compact block.`,
  tools: [new FindClientTool(), new UpsertClientTool()],
});
