# Sucafina Sample Chaser — Client Discovery Questions

> Companion to `data-dictionary.md`. These are the questions to ask the Sucafina Quality/Trade team to (a) confirm what we inferred from the chat + spreadsheet, and (b) surface the information the chat **cannot** give us. Prioritized: **🔴 must-have** (agent can't be accurate without it), **🟡 important**, **🟢 nice-to-have**.

---

## The single most important insight to raise first

**The chat can realistically fill only ~8 of the ~16 active columns.** From a dispatch message we get: Date, Receiver/Client, Name/Quality, Grade, Sample Type, AWB#, Courier, Qty, and (later) Result + Comments. The rest — **Outturn, ICO Mark, Sample Ref, Bags, Client Ref, Crop Year, Crop/Area, Moisture, Water Activity** — are almost never in chat. They live in another system or in someone's head.

So the #1 question is strategic, not detail:

> **🔴 "For the columns that never appear in chat, where does that data actually come from today, and can the agent read it directly?"** (SAP? a lot-master/warehouse system? a cupping-lab sheet? the person just knows it?)

Everything else is detail. If the answer is "the agent must integrate System X to fill those," that reshapes the build. If the answer is "partial rows are fine, a human tops them up," that's a much smaller agent.

---

## Top 5 questions that most improve performance

1. 🔴 **Source of truth for the non-chat fields** (above) — what to integrate vs. leave blank.
2. 🔴 **Sample reference generation** — Who assigns `SL-####` / `SSKE-#####` / `TYPE - ###`, and how? Is it sequential from a system, or manual? *(Determines whether the agent creates the ID or looks it up — the difference between "insert a record" and "match an existing one.")*
3. 🔴 **Ground-truth pairs** — Can they give us more chat history **alongside the exact spreadsheet rows those messages produced?** *(This is what lets us measure extraction accuracy and tune the agent. Nothing improves performance more.)*
4. 🟡 **Specialty vs Bulk routing** — Is there a firm rule for which sheet a sample lands in, or is it the trader's judgment? *(Currently fuzzy — SL- refs appear in both sheets.)*
5. 🟡 **Input channels** — Is Teams chat the only source, or do dispatches/results also happen over email/WhatsApp/attachments? *(They say "I'll put this in email too" constantly — we may be missing half the events.)*

---

## A. Column-by-column confirmation (their "what does each header mean" ask)

Bring this as a table for them to check/correct in ~10 minutes. For each field, confirm: **definition · required? · allowed values · where the data comes from.**

| Field | Our current understanding | Ask them to confirm |
|-------|---------------------------|---------------------|
| Date | Date the sample was **dispatched** | Dispatch date, or request date, or something else? |
| REF / Sample Ref | Lot / sample reference | Meaning of each prefix (SL, SSKE, SSUG, SSGP, SSPG, DS, OS, TYPE) — see §D |
| Outturn | Milling outturn / warehouse mark (`17KN0076`) | Confirm; and its source system |
| Name (Specialty) | Estate / station / mark | Confirm |
| Quality (Bulk) | Grade + blend + % (`AA PLUS (30%), AB (70%)`) | Confirm; is the % breakdown always required? |
| GRADE | Kenyan screen grade (AA/AB/PB/C/E/TT) | Confirm; and NH, MH, ML, HE meanings |
| Bags | # bags in the source lot | Confirm; where sourced |
| Description (Specialty) | Purpose (`WOC samples`) | What is **WOC**? What other values are valid here? |
| Sample Type (Bulk) | Type / Offer / PSS | Confirm the 3 base types + the PSS month/replacement structure |
| Client / Receiver | Recipient (external client **or** internal office) | Confirm; how they want internal transfers (Sucafina NV, Geneva) tagged |
| Client Ref | Client's own reference (`Zoegas/Nestle ref`) | Where does this come from? |
| ICO Mark | ICO lot mark | Confirm; source |
| Country | Destination country | Confirm it's destination (not origin) |
| AWB# | Courier tracking number | Confirm; preferred stored format |
| Courier | Carrier | Confirm the canonical carrier list |
| Qty | Quantity | **grams or bags?** (see §E) |
| Moisture / Water Activity | Green lab analysis | Who measures, when, source system |
| Delivery date | Date received | How is delivery confirmed — courier API, or someone reports it? |
| Result | Approved / Rejected | Confirm; + the scoring scale (see §F) |
| Comments | Tasting notes / remarks | Confirm free-text |
| Crop Year / Crop-Area | Harvest year / origin region | Source system? |

> Also confirm: **which columns are mandatory** for a row to be "valid," and whether columns T–AF (currently blank) are dead or reserved.

---

## B. Where the data lives (source-of-truth map) 🔴

For each field the chat doesn't carry, ask:

- Is there a **lot master / green inventory system** (SAP? a warehouse app?) that holds Outturn, ICO Mark, Bags, Crop Year, Crop/Area for a given lot? Can we query it by lot ref?
- Is there a **cupping-lab record** where Moisture, Water Activity, scores, and Approved/Rejected are entered? Should results flow from there instead of chat?
- Is there a **CRM / client master** behind the "Client Details" tab? (It's currently a manually-maintained address book with duplicates.)
- Where do **Client Refs** (Zoegas/Nestle numbers) originate?

---

## C. Reference & ID generation 🔴

- Who assigns `SL-####`, `SSKE-#####`, `TYPE - ###`? A system, or a person typing the next number?
- Are they **sequential**? If so, should the agent generate the next one, or must it come from elsewhere?
- What do the letters encode? (We think `SS` + country: KE=Kenya, UG=Uganda, RW=Rwanda, BI=Burundi — confirm. And SSGP / SSPG / DS / OS?)
- `REBAG#####` — what triggers a rebag, and does it create a new ref?

---

## D. Record structure & routing 🟡

- **Specialty vs Bulk** — firm rule, or judgment call? What signals decide it?
- **One AWB, many rows** — confirmed for type-sample batches and the forwarding sheet. Any rule for when to split vs. combine?
- **E A Forwarding sheet** — when does a dispatch get per-bag ID lines here vs. a single Bulk row? Is there a LATAM/Asia equivalent, or is this East-Africa only?
- When a message is vague ("send *the samples*", "sort out *this one*"), how does the team know which lot? Is there context the agent would also need?

---

## E. Controlled vocabularies 🟡

- Are there **official master lists** for Courier, Country, Grade, Sample Type, and Client names? (The sheet has 13–80 spelling variants per field — we want the canonical set.)
- **Qty units** — are bare numbers grams or bags? Is `1KG` special? How are roasted-vs-green quantities recorded (e.g. "300g green + 100g roasted")?
- Any grades/sample types **not seen** in our 6-week sample that we should plan for?

---

## F. Cupping & result model 🟡

- What **scoring scale**? (SCA 100-point? The chat shows "82+", "83p", "85-86" — is "p" = points?)
- What score/criteria makes a sample **Approved vs Rejected**? Who makes the call?
- Where are results **supposed** to land? (Specialty's Result column is ~empty — is that a gap, or do results live in email/lab?)
- Defect vocabulary (quakers, moldy, "FAQ minus") — is there a standard defect list to normalize against?

---

## G. Operating model & channels 🟡

- **Is Teams chat the only input?** They reference email constantly ("I'll put this into email as well") and share Excel attachments in-thread. Do we need email + attachment ingestion too?
- **Which chats/teams** feed the log — just "Quality / Trade", or several regional channels?
- **Language** — the chat mixes English with Swahili ("sawa") and French ("Merci"). Any other languages at other origins?
- **Volume** — roughly how many samples/dispatches per day? (Drives throughput + human-review design.)
- **Human-in-the-loop** — should the agent auto-write rows, or propose them for a person to confirm? What error rate is acceptable?
- **SLA** — how fast must a chat event become a row (real-time, end-of-day)?

---

## H. Lifecycle & exception handling 🟢

- **Replacements** — a `PSS … (replacement)` — does it overwrite the original row or add a new one?
- **Cancellations / re-sends / lost shipments** — how are these recorded today?
- **Retention samples** and **claim lots** — do these get rows, and how are they flagged?
- **Partial dispatch** — 5 requested, 3 sent — how is that logged?

---

## I. Integration & access 🟡

- Where does the workbook actually live — **Excel on SharePoint, or Google Sheets**? (Affects how the agent writes.)
- Can we get **API/write access**, and who owns/approves that?
- Who is allowed to edit the log today, and would that change with an agent writing to it?

---

## J. Artifacts to request (bring back the goods)

1. 🔴 **More chat history + the matching filled rows** — as many chat↔row pairs as they'll share. This is our evaluation set.
2. 🟡 The **blank current-season template** (2025-2026) and any **SOP / training doc** for filling it.
3. 🟡 A **master client list** (behind the Client Details tab) with canonical names + addresses.
4. 🟡 A **lot-master export** (or read access) so we can see Outturn/ICO/Crop fields at source.
5. 🟢 A handful of **"hard" messages** they remember being ambiguous — great stress-tests for the agent.

---

### How to frame it with the client
Lead with the strategic one (§B — where does the non-chat data live), because the answer determines whether this is a *chat-to-sheet transcriber* (small, fast to ship) or a *cross-system record builder* (bigger, needs integrations). Everything else is confirmation detail we can gather in a single 45-minute working session with the column table in §A on screen.
