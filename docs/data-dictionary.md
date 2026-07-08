# Sample Chaser — Data Dictionary & Chat→Sheet Mapping

> **Purpose.** This document teaches the agent how to turn the *natural-language chatter* of Sucafina's "Quality / Trade" team (see `Quality - Trade Teams Chat.docx`) into *structured rows* in the Sample Chaser workbook (`Sample Chaser2025-2026 - Sample Chaser.xlsx`). It is the semantic layer for **data-in**: "when a human says X in chat, it means field Y, and here is how to normalize it."
>
> Built by reverse-engineering ~840 chat lines against the live workbook (4 sheets, ~3,700 sample rows). Every enum, format, and mapping below is grounded in observed data. Items I could not confirm from the data are marked **⚠️ inferred — confirm with team**.

---

## 1. The domain in one minute

Sucafina's East Africa QC/trade desk ships **coffee samples** to clients and internal offices so they can *cup* (taste) and *approve* coffee before a shipment or sale. The workbook is a **sample dispatch + result log**. Each row is one sample sent to one recipient, tracked from request → dispatch → delivery → cupping result.

The chat is where the work actually happens: traders **request** samples, the lab/QC **prepares and dispatches** them (sharing an **AWB** = Air Waybill courier tracking number), recipients **cup** them, and the team records the **result** (Approved / Rejected). The spreadsheet is the human's after-the-fact transcription of those chat events. **Our agent automates that transcription.**

---

## 2. Sample lifecycle (the state model)

Every sample row moves through these states. Each state is signalled by a distinct kind of chat message (the "archetypes" in §7). The agent's job is to detect the state and fill the fields that become available at that state.

| # | State | Chat trigger (archetype) | Fields that get set |
|---|-------|--------------------------|---------------------|
| 1 | **Requested** | "Please organize dispatch of X to Y", "can we get an offer sample of…", "could you prepare samples for…" (A) | Client/Receiver, Name/Quality, Grade, Sample Type, Qty, Crop/Area, sometimes destination address. **Creates a pending row.** |
| 2 | **Prepared / roasted** | "bulk done", "finishing roasting at Nairobi Lab", "we have 100g" | (usually no new fields — readiness signal) |
| 3 | **Dispatched** ⭐ | "dispatched … tracking details :<AWB> <courier>", "AWB: …", "Waybill Number …", "DHL Tracking Number for … :" (B) | **Date, AWB#, Courier** (+ confirms Receiver/Client, Name). **This is the highest-value event.** |
| 4 | **Delivered** | "the samples have been delivered", "expected to be delivered today", "confirm X received" (C) | Delivery date |
| 5 | **Cupped / Result** | "Cupping notes: …", "scoring 85-86", "confirmed this lot", "Rejection 1 – defected" (D/E) | Comments (tasting notes), Result (Approved/Rejected), score, Moisture/Water Activity |

**Key linkage rule:** a *Dispatched* message (state 3) usually refers back to an earlier *Requested* message (state 1) for the same recipient. The agent should **match and update the existing pending row**, not create a duplicate. Match on `Receiver/Client + Sample name/grade + rough time window`.

---

## 3. Which sheet? (routing rules)

The workbook has four sheets. The first decision on any data-in is *which sheet the row belongs to*.

| Sheet | What it holds | Route here when… |
|-------|---------------|------------------|
| **Specialty Samples 2024-2025** | Individual specialty-position lots sent for evaluation | Ref is `SL-####`; has an **Outturn** mark (e.g. `17KN0076`); station/estate **Name** (e.g. `KABINGARA/KIRINYAGA`); grade is per-lot (AA/AB/PB); recipient is often internal (`Sucafina NV`, `Geneva`); Description like `WOC samples`. |
| **BulkSamples 2024-2025** | Commercial / offer / type / pre-shipment (PSS) samples tied to a client + destination country | Ref is `SSKE-#####`, `TYPE - ###`, or `SL-####`; has a **Client** and a destination **Country**; **Sample Type** is Offer / Type / PSS; may carry Moisture & Water Activity. |
| **Client Details** | Address book (lookup, not a log) | Never a data-in target for samples. **Read** it to resolve "send to Beyers" → contact + full address. |
| **E A Forwarding 2024-2025** | Per-bag East-Africa forwarding log for shipment samples (`SS**` refs) with individual bag **ID Numbers** (e.g. `UGF/25/015`) | Bulk multi-bag origin dispatches (e.g. Uganda Robusta → Itochu Japan) where each bag gets its own ID line under one AWB. |

⚠️ **Specialty vs Bulk is fuzzy** in the source data (SL- refs appear in both). Heuristic: *offer/type/PSS with a named external client + country → Bulk; single specialty lot with an Outturn mark / internal receiver → Specialty.* When ambiguous, the agent should ask or default to the sheet the trader named.

---

## 4. Field dictionary

### 4.1 Specialty Samples 2024-2025

Columns A–P. (Q–AE exist but are unused/scratch.)

| Col | Field | Meaning | Type | Req? | Example | Chat source & extraction |
|-----|-------|---------|------|------|---------|--------------------------|
| A | **Date** | Dispatch date | date | ✔ | `2026-06-11` | Message timestamp of the *dispatch* message (state 3). |
| B | **REF** | Sample reference / lot number | text | ✔ | `SL-7346` | Explicit in chat, or looked up from the lot being discussed. See §6 for formats. |
| C | **Outturn** | Milling outturn / warehouse mark | text | – | `17KN0076` | Given by lab; rarely in casual chat. |
| D | **Name** | Estate / station / mark name | text | ✔ | `KABINGARA/KIRINYAGA`, `AA SANGALAI` | The coffee being sent — e.g. "AA Swara", "Sangalai AA". |
| E | **GRADE** | Screen/quality grade | enum+ | ✔ | `AA`, `AB`, `PB` | From the coffee name/description. See §5.4. |
| F | **Bags** | Number of bags in the source lot | number | – | `732` | "we have 732 bags of AB…" |
| G | **Description** | Purpose / sample context | text | – | `WOC samples` | Free text — reason for the sample (see glossary: WOC). |
| H | **Receiver/Company** | Who receives it (client OR internal office) | text | ✔ | `sucafina NV`, `Geneva` | "sent … to Geneva", "to Key Coffee". Resolve against Client Details. |
| I | **AWB#** | Courier tracking / air waybill number | text (digits) | – | `7726241423` | The number in a dispatch message. **Store digits-only as text** (see §9). |
| J | **Courier** | Carrier | enum | – | `DHL` | Word next to the tracking number. See §5.1. |
| K | **Qty** | Quantity sent | text/number | – | `500`, `1KG` | "1kg shipment sample", "300g green". See §5.6. |
| L | **Delivery date** | Date received | date | – | | Delivery-confirmation message (state 4). |
| M | **Result** | Cupping outcome | enum | – | `Approved` | Cupping/approval message (state 5). Mostly empty here. See §5.5. |
| N | **Comments** | Tasting notes / remarks | text | – | | Cupping notes body. |
| O | **Crop Year** | Harvest year | text | – | `2025/2026` | From lot metadata / crop discussion. |
| P | **Crop/Area Details** | Origin region detail | text | – | | Growing area / county. |

### 4.2 BulkSamples 2024-2025

Columns A–S. (T–AF unused.)

| Col | Field | Meaning | Type | Req? | Example | Chat source & extraction |
|-----|-------|---------|------|------|---------|--------------------------|
| A | **Date** | Dispatch date | date | ✔ | `2026-06-26` | Dispatch message timestamp. |
| B | **Sample Ref** | Sample reference | text | ✔ | `TYPE - 980`, `SSKE-104933` | See §6. |
| C | **Bags** | Bags in source lot | number | – | | As above. |
| D | **Quality** | Full quality description (grade + blend + %) | text | ✔ | `AA PLUS (30%), AB (70%) - Sample 1` | The coffee spec. Grade(s) embedded here (see §5.4). |
| E | **Client Ref** | Client's own reference number | text | – | | "Zoegas/Nestle reference number" |
| F | **ICO Mark** | International Coffee Org mark | text | – | | Lot metadata. |
| G | **Sample Type** | Purpose category | enum | ✔ | `Offer sample`, `Type sample`, `PSS June Shipment` | See §5.3 — the most information-rich enum. |
| H | **Client** | Client name (external) OR internal contact | text | ✔ | `Beyers`, `Edmax Coffee`, `Muki Kristiya Bongers` | "send to Beyers", "samples for Folgers". |
| I | **Country** *(trailing space in header)* | Destination country | enum | – | `Netherlands`, `KENYA` | Client's country / "sent to China". See §5.2. |
| J | **AWB#** | Courier tracking number | text (digits) | – | `4720988322` | As specialty. |
| K | **Courier** | Carrier | enum | – | `DHL` | See §5.1. |
| L | **Qty** | Quantity | number | – | `300`, `200` | grams (see §5.6). |
| M | **Moisture** | Green moisture % | number | – | | Lab analysis. |
| N | **Water Activity** | Water activity (aw) | number | – | | Lab analysis. |
| O | **Delivery date** | Date received | date | – | | Delivery message. |
| P | **Result** | Approved / Rejected | enum | – | `Approved` | Cupping result. See §5.5. |
| Q | **Comments** | Notes | text | – | | Free text. |
| R | **Crop Year** | Harvest year | text | – | | |
| S | **Crop/Area Details** | Origin detail | text | – | | |

### 4.3 Client Details (lookup)

| Col | Field | Example |
|-----|-------|---------|
| A | **Client / Company** | `49th Parallel`, `Ahold Coffee Company` |
| B | **Attention To** (contact person) | `David Pohl` |
| C | **Full Address** | `3893 Degnan Blvd, Los Angeles, 90008, USA` |
| D | **Phone no.** | `(+)310-526-1416` |
| E | **Email Address** | |
| F | *(unused)* | |

> Use for **address resolution**: when a dispatch names only a company ("send to Beyers"), look up the address/contact here. Note: multiple rows per client exist (different offices) — disambiguate by contact or country.

### 4.4 E A Forwarding 2024-2025 (per-bag forwarding log)

| Col | Field | Example |
|-----|-------|---------|
| A | Date | `2025-09-01` |
| B | Sender | `Kenyacof` |
| C | Origin | `Uganda` |
| D | Sample Ref | `SSUG-97043` |
| E | Coffee Quality | `Robusta` |
| F | Receiver/Company | `Itochu Japan` |
| G | **ID Number** (per-bag) | `UGF/25/015` |
| H | AWB# | `Y0231587736` |
| I | Courier | `UPS` |
| J | Qty | |

> One AWB spans many bag ID lines. Route here when a dispatch enumerates individual bag IDs.

---

## 5. Controlled vocabularies (normalize on the way in)

The source data is riddled with casing/spelling variants. On data-in, **map to the canonical value** and store that.

### 5.1 Courier (col J/K)
| Canonical | Observed variants |
|-----------|-------------------|
| `DHL` | DHL, dhl, `DHL ` |
| `FedEx` | Fedex, FedEX, fedex, FEDEX, FedEx |
| `UPS` | UPS |
| `Kiptoo` | KIPTOO, Kiptoo, kiptoo |
| `Rider` | Rider, rider |
| `Wells Fargo` | Wells Fargo, wellsfargo, Wells fargo, Fargo |
| `Hand Delivery` | HD, hd, H/D, By Hand |
| `Picked by Client` | Picked by Client |
| `SGS Kenya` | SGS Kenya |

Rule: **case-insensitive match, collapse whitespace, map to canonical.**

### 5.2 Country (col I, Bulk)
68 raw variants collapse to ~40 countries. Canonical = **Title Case**. Explicit merges: `CHINA/China → China`; `Kenya/KENYA/kenya → Kenya`; `S.KOREA/south Korea/SOUTH KOREA → South Korea`; `NETHERLANDS → Netherlands`; etc. Top destinations: Switzerland, Netherlands, Kenya, Sweden, South Korea, China, USA, Belgium, Germany, Japan.

### 5.3 Sample Type (col G, Bulk) — decompose, don't just copy
80 raw variants. There are really **three base types** plus modifiers:

| Base type | Meaning | Raw variants |
|-----------|---------|--------------|
| `Type Sample` | Represents a *quality type* offered for approval | Type sample, Type Sample, TYPE SAMPLE |
| `Offer Sample` | Sample backing a specific sales offer | Offer Sample, Offer sample |
| `PSS` | **Pre-Shipment Sample** — must match the coffee about to ship | `PSS <Month> Shipment` (+ `(Replacement)`) |

For **PSS**, the string encodes extra structure the agent should parse out:
- **Shipment month:** `PSS June Shipment` → month = June
- **Replacement flag:** `PSS May Shipment(replacement)` → replacement = true

⚠️ Suggested normalized shape: `{ type: "PSS", shipment_month: "June", replacement: false }`. Also seen: WOC samples, Retention, Claim (treat as tags/purpose).

### 5.4 Grade (col E Specialty / embedded in col D Bulk Quality)
Kenyan screen-size & quality grades:
| Grade | Meaning |
|-------|---------|
| `AA` | Largest screen (17/18) — top |
| `AB` | Screen 15/16 — the workhorse grade |
| `PB` | Peaberry |
| `C` | Smaller than AB |
| `E` | Elephant (largest) |
| `TT` | Lighter beans winnowed from AA/AB |
| `HE` / `MH` / `ML` | ⚠️ likely Mbuni (natural/unwashed) grades — *confirm* |
| `NH` | ⚠️ *confirm* |

Modifiers seen: `TOP`, `PLUS`, `FAQ` (Fair Average Quality — commercial standard), `SC 17` (Screen 17). Blends written as `AA PLUS (30%), AB (70%)`. Grade may need to be extracted from a free-text Quality/Name string.

### 5.5 Result (col M/P)
| Canonical | Signals in chat |
|-----------|-----------------|
| `Approved` | "confirmed this lot", "approved", positive cupping ("nice, clean, 83p") |
| `Rejected` | "Rejection 1 – defected", "moldy", "quakers", "inconsistent" |
| `Pending` | requested/dispatched but no cupping outcome yet |

(Only ~61 of Bulk rows have a result; Specialty's Result column is essentially unused — most samples never get a logged verdict.)

### 5.6 Qty units (col K/L)
Mixed: bare numbers are **grams** (`500`, `300`), explicit `1KG` = 1000 g. Bulk offer rows sometimes record **bags** (`200`). ⚠️ Ambiguous — recommend normalizing to `{ value, unit }` and, on data-in, defaulting bare numbers in Specialty to grams. Confirm the bulk "200" convention with the team.

---

## 6. Sample reference formats (col B)

| Prefix | Meaning | Example | Sheet |
|--------|---------|---------|-------|
| `SL-####` | Specialty **L**ot reference | `SL-7346` | Specialty (also Bulk) |
| `SSKE-#####` | **S**hipment **S**ample – **KE**nya | `SSKE-104933` | Bulk |
| `SSUG-#####` | Shipment Sample – Uganda | `SSUG-97043` | E A Forwarding |
| `SSRW- / SSBI-` | Rwanda / Burundi shipment samples | | Bulk |
| `SSGP- / SSPG-` | ⚠️ origin/location code — *confirm* | | both |
| `TYPE - ###` | Type-sample sequence number | `TYPE - 980` | Bulk |
| `OS- / OFFER` | Offer sample | | both |
| `DS-` | ⚠️ *confirm* | | Specialty |
| `REBAG#####` | Rebagged-lot reference | `REBAG00117` | in Quality text |
| Outturn marks | `##XX####` = year + origin + serial | `17KN0076` (KN=Kenya) | col C |

Pattern: `SS` + 2-letter country + serial = origin-coded shipment sample.

---

## 7. Chat message → field extraction patterns

These are the recurring message shapes. For each: the trigger, a regex-style pattern, and what it fills.

### Archetype A — Sample **request** (→ create pending row)
Triggers: "please organize dispatch of…", "can we get an offer sample of…", "could you prepare samples for…", "send both X and Y please", "Could we send them samples for that".
```
Extract → Client/Receiver, Name, Grade, Sample Type (offer/type/PSS),
          Qty (if stated), Crop/Area, destination address (if given)
Set     → Status = Requested
```
Example: *"Ok team - can we get an offer sample sent over of the AA Swara RFA at +80? This could serve as the PSS if approved"*
→ `{ Name: "AA Swara", Grade: "AA", Sample Type: "Offer Sample (→PSS if approved)", note: "RFA, +80" }`

### Archetype B — Dispatch **confirmation** ⭐ (→ AWB + Courier + Date)
The single most valuable pattern. Courier can appear **before** or **after** the number.
```
Patterns (case-insensitive):
  "tracking details ?:? <NUM> <COURIER>"
  "<COURIER> ... (Waybill Number|AWB:?|Tracking Number ...:) <NUM>"
  "via <COURIER> ... <NUM>"
Extract → AWB# = digits of <NUM>; Courier = normalize(<COURIER>);
          Receiver/Client, Name (from message or linked request);
          Date = message timestamp
Set     → Status = Dispatched; update the matching pending row
```
Real examples (all from the chat):
| Message | AWB# | Courier | To |
|---------|------|---------|----|
| "dispatched samples to Key coffee tracking details :872526345980 Fedex" | 872526345980 | FedEx | Key Coffee |
| "we sent the samples tracking details:1487722062 DHL" | 1487722062 | DHL | (Jojo) |
| "sent the ABC samples to Geneva tracking details :7726241423 DHL" | 7726241423 | DHL | Geneva |
| "dispatched AA SWARA tracking details :4215427635 DHL" | 4215427635 | DHL | (US) |
| "We dispatched the sample to China via DHL Waybill Number 1042774655." | 1042774655 | DHL | China |
| "We dispatched the samples to Thomas via DHL, AWB: 9620551651." | 9620551651 | DHL | Thomas @ Beyers |
| "DHL Tracking Number for Folgers: 4720858811" | 4720858811 | DHL | Folgers (Florida) |

### Archetype C — Delivery confirmation (→ Delivery date)
Triggers: "the samples have been delivered", "expected to be delivered today", "confirm X received the samples?" → yes.
```
Set → Delivery date = date; Status = Delivered
```

### Archetype D/E — Cupping notes & result (→ Comments + Result)
Triggers: "Cupping notes: …", "scoring 85-86", bullet lists with scores.
```
Score formats: "82+", "83p", "84-86pts", "85-86"
Extract → Comments = the tasting text; Score = number/range;
          Result = Approved (confirmed/clean/positive) | Rejected (defected/moldy/quakers/inconsistent)
```
Example: *"• PSS3: 83p / nice pleasant acidity, citrus driven, more complex, clean"* → `{ Result: Approved, Score: 83, Comments: "…citrus driven, clean…" }`; *"Rejection 1 - obviously defected cup - moldy, inconsistent"* → `{ Result: Rejected }`.

### Archetype F — Quantity / roast spec (→ Qty, Description)
*"300g green sample / 100g roasted to usual profile (14% development) / 100g roasted darker (16-18%)"* → Qty + roast-profile notes into Description.

---

## 8. Domain glossary

| Term | Meaning | Confidence |
|------|---------|-----------|
| **PSS** | Pre-Shipment Sample — drawn from the actual lot about to ship; must match the offer/approval | high |
| **Type sample** | Sample representing a *quality type* being offered | high |
| **Offer sample** | Sample tied to a specific sales offer | high |
| **Retention sample** | Sample kept back from a shipment for later reference/claims | high |
| **Claim lot** | Lot under a quality dispute/claim | high |
| **AWB** | Air Waybill — courier tracking number | high |
| **Outturn** | Milling outturn identifier / warehouse mark (e.g. `17KN0076`) | high |
| **ICO Mark** | International Coffee Organization mark identifying the lot | high |
| **FAQ** | Fair Average Quality — the standard commercial grade benchmark ("FAQ minus", "FAQ+") | high |
| **AA / AB / PB / C / E / TT** | Kenyan screen-size / quality grades | high |
| **TOP / PLUS** | Premium quality tiers above the base grade | high |
| **Mbuni** ("Heavy Mbuni") | Natural / dry-processed (unwashed) Kenyan coffee | high |
| **Triage** | Lowest sorting grade / defect fraction | high |
| **Cup / cupping** | Standardized tasting evaluation | high |
| **Quakers** | Under-developed beans that roast pale — a defect | high |
| **WOC samples** | ⚠️ likely **World of Coffee** (trade expo) samples — *confirm* | inferred |
| **RFA** | ⚠️ likely **Rainforest Alliance** certified | inferred |
| **SC 17** | Screen size 17 | high |
| **Thika / Nairobi Lab** | Kenya QC lab / warehouse locations | high |
| **Sangalai, Swara, Ngacha, Kairima, Millstone** | Estate / washing-station / brand mark names | high |
| **Sucafina NV / Geneva / China (office)** | *Internal* Sucafina destinations (not end clients) | high |

Recurring people (chat participants → likely role): **Omar Chahine, Muki Kristiya Bongers, Ivo Sarjanovic, Anička Marková** = traders/quality leads (requesters); **Bernard Chege, Brillian Cherono, Harriet Muthoni Muhia, Gloria Mosonik, Brian Were, Margaret Mbugua, kenyacofspecialtyqc** = Kenya lab/QC/dispatch (fulfillers). Useful for classifying who is requesting vs. who is confirming dispatch.

---

## 9. Data-quality / normalization rules (apply on every data-in)

1. **AWB#** — store as **text, digits only**. Source data has ints (`4720988322`), leading-newline strings (`'\n9620551651'`), and spaces. Strip everything non-digit; keep as string to preserve any leading zeros.
2. **Courier / Country / Sample Type** — normalize to canonical (§5). Never write a raw variant.
3. **Headers have trailing spaces** in the source (`"Country "`, values like `"DHL "`) — trim on read and write.
4. **Dates** — accept `datetime`, `DD/MM/YYYY` strings (`14/1/2025`), and relative words ("today", "tomorrow", "Tuesday"). Resolve relatives against the message date. Watch for Excel misparses (a grade cell held `1900-01-16`, i.e. a number wrongly typed as a date).
5. **Client field is polymorphic** — may be an external company *or* an internal Sucafina person/office. Flag internal destinations (Sucafina NV, Geneva, China office) distinctly from end clients.
6. **De-dup / link** — a dispatch confirmation should update the pending request row, not add a new one. Match on recipient + coffee + time window.
7. **One AWB → many rows** is legitimate (a batch of type samples shares one waybill, e.g. `TYPE-980…985` all under `4720988322`; the E A Forwarding sheet does this per bag).

---

## 10. Worked end-to-end examples

**Ex. 1 — dispatch confirmation → Bulk row**
> Chat: *Brillian Cherono, 29/Jun:* "We dispatched the samples to Thomas via DHL, AWB: 9620551651." (replying to Omar's 24/Jun request: "AB FAQ / ABC FAQ / Heavy Mbuni — send to Thomas Pitault at Beyers, as Types, Sept onwards")

| Field | Value | Source |
|-------|-------|--------|
| Date | 2026-06-29 | message date |
| Client | Beyers | "at Beyers" (+ Client Details lookup for address) |
| Country | Belgium | Client Details |
| Sample Ref | TYPE - 975 | matched to the type-sample request |
| Quality | AB FAQ / ABC FAQ / Heavy Mbuni | request list |
| Sample Type | Type Sample | "as Types?" → yes |
| AWB# | 9620551651 | "AWB: 9620551651" |
| Courier | DHL | "via DHL" |
| Result | Pending | not yet cupped |

**Ex. 2 — request only → pending Specialty row**
> Chat: *Brian Were:* "Edmax are out for some 7 bags of AB. Could we send them samples? Address Pangani, Nyasi Lane, near Maguna Supermarket."

→ `{ Name: "AB", Grade: "AB", Bags: 7, Receiver: "Edmax Coffee", address: "Pangani, Nyasi Lane…", Sample Type: "Offer Sample", Status: Requested }` — AWB/Courier/Date filled later when dispatch is confirmed.

**Ex. 3 — cupping result → update Result + Comments**
> Chat: *Ivo:* "Cupping notes: • Type ABC -82+ generally good, pleasant acidity … • PSS3: 83p, clean, consistent • Rejection 1 – defected, moldy"

→ On the ABC row: `Result: Approved, Score: 82, Comments: "generally good, pleasant acidity, loses structure when cools"`. On PSS3 row: `Result: Approved, Score: 83`. On Rejection-1 row: `Result: Rejected, Comments: "defected, moldy, inconsistent"`.

---

## 11. Open questions to confirm with Sucafina

1. **WOC** and **RFA** — confirm expansions (World of Coffee / Rainforest Alliance?).
2. **Grade codes** NH, MH, ML, HE — full meanings.
3. **Ref prefixes** SSGP, SSPG, DS, OS — origin/type meanings.
4. **Qty units** in Bulk — are bare numbers grams or bags? (Specialty appears to be grams.)
5. **Specialty vs Bulk routing** — is there a firm rule, or is it the trader's judgment call?
6. **Result column** — Specialty samples almost never get a logged result. Is that intentional (results live in email) or a gap the agent should fill?
7. **Crop Year / Crop-Area** — where does the agent source these (SAP? lot master?) since they're rarely in chat.
