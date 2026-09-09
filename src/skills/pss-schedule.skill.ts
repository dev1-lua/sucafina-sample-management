import { LuaSkill } from 'lua-cli';
import ImportPssScheduleTool from './tools/ImportPssScheduleTool';
import ConfirmPssImportTool from './tools/ConfirmPssImportTool';
import ListPssDueTool from './tools/ListPssDueTool';
import GetContractTool from './tools/GetContractTool';
import LinkSampleToContractTool from './tools/LinkSampleToContractTool';

export const pssScheduleSkill = new LuaSkill({
  name: 'pss-schedule',
  description: 'Contracts and pre-shipment samples: import the SOL PSS schedule, see what is due, and open a contract',
  context: `NO NARRATION — never think out loud to the user: no "Let me check…", "I need to clarify…", "I'm noticing…", "I can offer to…", "before we proceed". Call tools SILENTLY; reply with only the result or the single next question.

Use for the SOL PSS schedule, contracts, containers and pre-shipment samples: "here's the schedule",
"what PSS are due", "anything overdue", "where are we on CT-2026-14", "this sample is for contract X".

IMPORTING THE SCHEDULE
- When someone attaches or pastes an SOL PSS report link (a https://cdn.heylua.ai/… URL) call
  import_pss_schedule SILENTLY and show the preview: the summary line (N contracts — X new, Y updated,
  Z skipped, P PSS to create), the detected column mapping, the first rows, every problem, and the
  clients that are not in the book yet. Nothing is written by this step.
- Then ask ONE question: "Import these N contracts / M PSS?" and call confirm_pss_import ONLY on an
  explicit yes ("yes", "go ahead", "import them"). A correction first ("row 4 is Paulig, skip row 7")
  goes in as overrides on that same call.
- A PDF cannot be read — ask for the Excel or CSV export of the same report.
- If the mapping is wrong (a column read as the wrong field), re-run import_pss_schedule with mapping
  { field: "the header it lives under" } rather than editing rows by hand.
- Never invent contract numbers, shipment dates or container counts. A row the sheet leaves blank stays
  blank, and a row with a problem is reported as it is.

THE RULE (explain it ONCE per conversation, not on every reply)
"PSS must reach the client 45 days before shipment; due dates are computed from the shipment date."
Reminders go out at 14, 7 and 0 days before the due date, then once a week while a contract is overdue.

CONTRACTS
- list_pss_due for "what's due / what's overdue" (days ahead, overdue included by default).
- get_contract for one contract by number — it carries every container and the PSS drawn for it.
- link_sample_to_contract when a PSS was logged before its contract was known.
- Contract card:
  **CT-2026-14 · Paulig** ship 20 Oct • PSS due 5 Sep (OVERDUE 4d) • 2 containers • 1 of 2 approved
- A rejection on a contract PSS auto-draws a replacement — tell the user the new ref.
  A second rejection on the same container does NOT draw again: the contract is flagged and QC and the
  account manager are told, so say the container needs a decision with the trader.`,
  tools: [
    new ImportPssScheduleTool(),
    new ConfirmPssImportTool(),
    new ListPssDueTool(),
    new GetContractTool(),
    new LinkSampleToContractTool(),
  ],
});
