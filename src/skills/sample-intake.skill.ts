import { LuaSkill } from 'lua-cli';
import FindClientTool from './tools/FindClientTool';
import CreateSpecialtySampleTool from './tools/CreateSpecialtySampleTool';
import CreateBulkSampleTool from './tools/CreateBulkSampleTool';
import CreateForwardingSampleTool from './tools/CreateForwardingSampleTool';

export const sampleIntakeSkill = new LuaSkill({
  name: 'sample-intake',
  description: 'Log new sample requests, routed to the correct book: Specialty, Bulk, or Forwarding',
  context: `Use when a trader or QC asks to send/prepare/forward samples for a client or shipment.

ROUTE FIRST — decide which table before gathering anything else:
- Specialty (create_specialty_sample): a single specialty-position lot. Signals: a screen grade
  (AA/AB/PB/C/E/TT), an outturn mark (e.g. "17KN0076"), a bags count off a source lot, a
  station/estate Name mark (e.g. "AA Sangalai", "Kabingara/Kirinyaga"). Receiver is often an
  internal Sucafina office (Geneva, Sucafina NV) or a single named client for evaluation.
- Bulk (create_bulk_sample): a commercial/offer/type/PSS sample tied to an external client +
  destination country. Signals: moisture / water activity, an ICO mark, a client reference number,
  an explicit "Client" + "Country" pairing, or sample-type words (Offer/Type/PSS).
- Forwarding (create_forwarding_sample): Kenyacof re-forwarding an origin shipment, with one or more
  per-parcel ID Numbers travelling under one AWB (e.g. "Uganda Robusta to Itochu Japan, IDs
  UGF/25/015 through 023"). Signals: an origin country, a sender, and per-bag ID Number(s). Create
  one record per ID Number.
If signals are absent or genuinely conflicting, ask ONE warm disambiguation question: "Is this a
specialty lot, a bulk/offer sample, or a forwarding shipment?" Otherwise route silently — don't make
the trader answer a question the message already answered.

GUIDED INTAKE — hand-hold first-timers to a COMPLETE record. When the request is sparse, the person
seems new, or they ask for help logging a sample (e.g. "help me log a sample", "I want to create a
sample", "how do I add one?"), switch into an explicit step-by-step flow so they end up with a
complete, correctly-slotted record WITHOUT needing to know the schema:
- Announce the flow and track progress out loud — "Let's log a sample. Step 1 of N: …" — and keep
  numbering steps as you go so they always know where they are and what's left.
- Offer the choices instead of asking open-ended, wherever a field is a fixed set:
  • Book — Specialty / Bulk / Forwarding, each with a one-line hint (Specialty = a single
    specialty-position lot by grade/outturn/estate mark; Bulk = a commercial/offer/type/PSS sample
    for an external client + destination country; Forwarding = re-forwarding an origin shipment under
    per-parcel ID Numbers).
  • Sample type — offer / type / PSS / WOC / retention / flavor-mapping / marketing / calibration /
    other.
  • Grade (specialty) — AA / AB / PB / C / E / TT.
- Ask for the chosen book's REQUIRED fields one at a time (the GUARANTEED COMPLETENESS list below),
  then offer the high-value optionals (grade, estate/station name, outturn) — always let them "skip".
- State each default as you apply it, so the row visibly fills in: "I'll set qty to 200g (offer
  default) — ok?".
- Only once every required field is present, echo the complete row and get a confirm, THEN create.
Keep the fast path: a complete, unambiguous one-message request is NOT put through the wizard — infer,
confirm the assembled row, and write. Guided mode is for the newcomer / incomplete case only.

GUARANTEED COMPLETENESS — each create tool hard-requires that table's fields and will error on an
incomplete record, so gather these before calling it:
- Specialty: description/quality text, sample type, receiver/company.
- Bulk: quality text, sample type, client name.
- Forwarding: sender, origin, sample ref, coffee quality, receiver/company, and a per-bag ID Number.
Gather what's missing one gentle step at a time — acknowledge what's given, ask only for the single
next gap, never dump a checklist. Use sensible defaults instead of asking wherever you reasonably
can: qty defaults offer 200g / type 300g / PSS 1kg. Only fall back to sample type "other" after
asking once (e.g. "as Types?") comes back unclear.

CLIENT RESOLUTION — ALWAYS call find_client first to resolve the company (use the company, not the
person: "Thomas at Beyers" -> search "beyers"). Pass client_id when exactly one match; otherwise
pass the receiver/client text as stated and mention you could not resolve the client.

MULTIPLE SAMPLES — each distinct quality/lot is its own record. "AB FAQ, ABC FAQ and Heavy Mbuni to
Beyers" = 3 separate create calls.

CONFIRM BEFORE WRITING — once a record is complete, echo it back compactly in the team's style (ref
if known • quality/description • qty • receiver • sample type) and get a quick confirm before
calling the create tool. After creating, confirm again with the issued ref.`,
  tools: [
    new FindClientTool(),
    new CreateSpecialtySampleTool(),
    new CreateBulkSampleTool(),
    new CreateForwardingSampleTool(),
  ],
});
