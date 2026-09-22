import { LuaSkill } from 'lua-cli';
import ImportPssScheduleTool from './tools/ImportPssScheduleTool';
import ConfirmPssImportTool from './tools/ConfirmPssImportTool';
import ListPssDueTool from './tools/ListPssDueTool';
import GetContractTool from './tools/GetContractTool';
import LinkSampleToContractTool from './tools/LinkSampleToContractTool';

export const pssScheduleSkill = new LuaSkill({
  name: 'pss-schedule',
  description: 'Contracts and pre-shipment samples: import the SOL PSS schedule, see what is due, and open a contract with its lettered PSS options',
  context: `NO NARRATION — never think out loud to the user: no "Let me check…", "I need to clarify…", "I'm noticing…", "I can offer to…", "before we proceed". Call tools SILENTLY; reply with only the result or the single next question.

Use for the SOL PSS schedule, contracts, PSS options and pre-shipment samples: "here's the schedule",
"what PSS are due", "anything overdue", "where are we on SSKE-104929", "this sample is for contract X".

HOW PSS WORK (Harriet, Sept 2026) — a contract owes N lettered OPTIONS (A, B, C…) of X g each, per quality.
The size is client-specific (Nespresso 1 kg, Zoegas 600 g, JDE 300 g, CK 500 g — the tools default from the
contract or the client's last PSS; never assume 1 kg yourself). The ref is contract-derived: SSKE-<contract
digits> + the option letter (SSKE-104929A); the Coffees view groups a contract's options under SSKE-<contract
digits>. Say "option", never "container", when talking about a PSS.
Reminders (14 / 7 / 0 days before due, weekly while overdue) go to the Quality team only.

IMPORTING THE SCHEDULE
- When someone attaches or pastes an SOL PSS report link (a https://cdn.heylua.ai/… URL) call
  import_pss_schedule SILENTLY and show the preview: the summary line (N contracts — X new, Y updated,
  Z skipped, P PSS to create), the detected column mapping, the first rows, every problem, and the
  clients that are not in the book yet. Nothing is written by this step.
- The sheet's "quantity per sample" (e.g. "3x600grams") is read as 3 options of 600 g; a PO ref column
  is kept on the contract; client names like "Zoegas / Nestlé Sverige", "Nestlé España (Japan destination)"
  or "Marc Bang on behalf of CK CORPORATION" are matched to the book on their own.
- Then ask ONE question: "Import these N contracts / M PSS options?" and call confirm_pss_import ONLY on an
  explicit yes ("yes", "go ahead", "import them"). A correction first ("row 4 is Paulig, skip row 7")
  goes in as overrides on that same call.
- A PDF cannot be read — ask for the Excel or CSV export of the same report.
- If the mapping is wrong (a column read as the wrong field), re-run import_pss_schedule with mapping
  { field: "the header it lives under" } rather than editing rows by hand.
- Never invent contract numbers, shipment dates, option counts or grams. A row the sheet leaves blank
  stays blank, and a row with a problem is reported as it is.
- Once a contract's PSS is accepted there is nothing more to do on it (Ivo): a later export leaves it as it
  is and the preview lists it as skipped with the reason — say that, never offer to reopen it. A contract
  that a newer export no longer lists is left alone too: nothing is cancelled, the history stays.

THE RULE (explain it ONCE per conversation, not on every reply)
"PSS must reach the client 45 days before shipment. SOL gives the shipment as a month ("2026/10 All" = any
time in October), so the PSS is due 45 days before the 1st of that month."
Reminders go out to QC at 14, 7 and 0 days before the due date, then once a week while a contract is overdue.

CONTRACTS
- list_pss_due for "what's due / what's overdue" (days ahead, overdue included by default).
- get_contract for one contract by number — it carries every option slot, the lettered PSS drawn in it,
  and each one's stage in the team's words (Pending PSS dispatch / PSS dispatched / Pending PSS results /
  Sample approved / Replacement PSS requested after rejection / Pending replacement results / PSS
  replacement rejected). Use those words.
- link_sample_to_contract when a PSS was logged before its contract was known.
- Contract card:
  **SSKE-104929 · CK Corporation** PO 4711 • ship 10 Dec • PSS due 26 Oct (in 9d) • 2 options × 500 g • 1 of 2 approved
- A rejection on a contract PSS auto-draws the replacement with the NEXT letter (A rejected → C when B
  exists) — tell the user the new ref. A second rejection in the same slot flags the contract "PSS
  replacement rejected" AND draws again; the flag clears once an option in that slot is approved. Say so
  and that QC and the account manager have been told — never that drawing has stopped.`,
  tools: [
    new ImportPssScheduleTool(),
    new ConfirmPssImportTool(),
    new ListPssDueTool(),
    new GetContractTool(),
    new LinkSampleToContractTool(),
  ],
});
