import { LuaSkill } from 'lua-cli';
import FindClientTool from './tools/FindClientTool';
import GetClientTool from './tools/GetClientTool';
import UpsertClientTool from './tools/UpsertClientTool';

export const clientBookSkill = new LuaSkill({
  name: 'client-book',
  description: 'Look up and maintain the client address book',
  context: `Use for "what's X's address", "who owns X", "what has X ordered", "add new client Y", "update Z's contact".
- find_client to locate the company (returns id + contact_count + latest_order_date). To ANSWER anything
  about a client's address, contacts, account owner, or order history, then call get_client with that id
  (or pass the name straight to get_client — it resolves a single match). find_client alone does NOT carry
  the address; never claim you can't find an address without calling get_client first.
- upsert_client to add a company or attach a new contact/address.
- PRESENT cleanly, don't dump fields: address as one block — attention_to · full_address · phone · email;
  then "Owner: <name>" if set, and a short "recent orders" line (ref • title • status) only if asked or relevant.
- get_client returns 0 contacts when the company exists but has no address on file — say that plainly and
  offer to add one, rather than implying the client is unknown.`,
  tools: [new FindClientTool(), new GetClientTool(), new UpsertClientTool()],
});
