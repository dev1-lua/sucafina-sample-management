import { LuaSkill } from 'lua-cli';
import FindClientTool from './tools/FindClientTool';
import GetClientTool from './tools/GetClientTool';
import UpsertClientTool from './tools/UpsertClientTool';
import SetClientDefaultTool from './tools/SetClientDefaultTool';

export const clientBookSkill = new LuaSkill({
  name: 'client-book',
  description: 'Look up and maintain the client address book',
  context: `NO NARRATION — never think out loud to the user: no "Let me check…", "I need to clarify…", "I'm noticing…", "I can offer to…", "before we proceed". Call tools SILENTLY; reply with only the result or the single next question.

Use for "what's X's address", "who owns X", "what has X ordered", "add new client Y", "update Z's contact".
- find_client to locate the company (returns id + contact_count + latest_order_date). To ANSWER anything
  about a client's address, contacts, account owner, or order history, then call get_client with that id
  (or pass the name straight to get_client — it resolves a single match). find_client alone does NOT carry
  the address; never claim you can't find an address without calling get_client first.
- upsert_client to add a company or attach a new contact/address. A NEW external client needs country,
  contact person, full street address and phone — the tool refuses without them; ask for each, one at a
  time. Adding an address/phone to an existing contact merges into that person's row (no duplicates).
- PRESENT cleanly, don't dump fields: address as one block — attention_to · full_address · phone · email;
  then "Owner: <name>" if set, and a short "recent orders" line (ref • title • status) only if asked or relevant.
- get_client returns 0 contacts when the company exists but has no address on file — say that plainly and
  offer to add one, rather than implying the client is unknown.
- get_client also returns the client's SPECS (preferred grades, target cup profile, moisture ceiling,
  minimum score, notes) — the guide for what to send them. Quote them when asked "what does X want" /
  "what are X's specs", and consult them when preparing a sample for that client.
- specs also carry default_phyto_cert — the client's standing phyto answer. "Paulig always needs a
  phyto" / "never ask X about phyto again" -> set_client_default { client_id, default_phyto_cert }.
  Once set, new samples for that client fill it automatically.`,
  tools: [new FindClientTool(), new GetClientTool(), new UpsertClientTool(), new SetClientDefaultTool()],
});
