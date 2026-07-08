# Task: Rebuild the Sucafina Sample Management UI + harden the backend for agent data-in

You are working in the repo at `/Users/devashishthapliyal/Documents/work/Lua/Sucafina`
(branch `feature/sample-management-agent`). **Read `ARCHITECTURE.md` first**, then
`api/migrations/001_init.sql`, `scripts/seed/run.ts`, `api/src/routes/samples.ts`,
`api/src/routes/clients.ts`, `api/src/routes/stats.ts`, and `dashboard/src/` before writing code.

## System recap (current state — verify by reading, don't assume)
- **Stack:** Express + Postgres 16 (port 5433) API; Vite + React 18 + react-router-dom dashboard;
  a lua-cli agent (`src/`) that goes THROUGH the API via `apiFetch` (actor `agent:chat`).
- **Single-writer rule:** the API is the only writer. Agent and dashboard both call it. Every
  mutation appends an event row stamped with an actor. **Preserve this — it is the point.**
- **Data source:** `docs/Sample Chaser2025-2026 - Sample Chaser.xlsx`, 4 sheets:
  - `Specialty Samples 2024-2025` (~1,063 rows) → the **Sample** tab
  - `BulkSamples 2024-2025` (~1,237 rows) → the **Bulk** tab
  - `E A Forwarding 2024-2025` (~15 rows) → the **Forwarding** tab
  - `Client Details` (~298 rows / 270 clients) → the **Clients** section
- **Legacy note:** there's an existing unified `samples` table (Specialty + Bulk merged via a
  `source_sheet` column). **Leave it in place — do not migrate to it or delete it.** It is NOT the
  model going forward.

## Goal — THIS IS THE CORE CHANGE
Three sheets = **three separate database tables** = **three separate UI tabs**. One dedicated table
per sheet, each holding **exactly the columns of its source sheet** (same labels, same order),
surfaced as its own tab in the UI. Plus a **Clients** section and a **Dashboard** of metrics/charts.

The whole thing should look and feel like **Twenty CRM**. Every row from every sheet must be present
— nothing dropped. The backend must make it trivial for the AI agent to push data IN (primary use
case) and pull data OUT, via a warm, conversational flow that guarantees complete, correctly-slotted
records.

## Build requirements

### 1. Three dedicated tables — one per sheet, exact columns
Create three new tables (migration `002_*.sql`), each mirroring its sheet's columns 1:1:
- **`specialty_samples`** — the Sample tab
- **`bulk_samples`** — the Bulk tab
- **`forwarding_samples`** — the Forwarding tab

The exact column list for each is in the **Appendix**. Each table also gets: `id uuid PK`,
`client_id uuid NULL` (optional link to `clients`), a `status` for the lifecycle, and
`created_at`/`updated_at`. Keep the messy source text verbatim in the sheet's own column; where you
want typed filtering/sorting (dates, quantity in grams, courier enum), add an optional companion
column (e.g. `qty_grams` next to `qty`, `courier_norm` next to `courier`) — but the tab must still
display the exact source column.

**Audit trail across three tables:** keep the single-writer + actor-stamped event log. Use one
polymorphic `events` table (`entity_type` = `'specialty' | 'bulk' | 'forwarding' | 'client'`,
`entity_id uuid`, `type`, `note`, `actor`, `created_at`) — or per-table event tables if you prefer.
Every create/update/delete appends an event naming the actor (`agent:chat`, `dashboard`, `api`).

### 2. Seed all three tables
Extend `scripts/seed/run.ts` to load each sheet into its own new table:
- `Specialty Samples 2024-2025` → `specialty_samples`
- `BulkSamples 2024-2025` → `bulk_samples`
- `E A Forwarding 2024-2025` → `forwarding_samples` (currently NOT ingested at all)
- `Client Details` → `clients` / `client_contacts` (as today)

Forwarding shape note: multiple `ID Number` rows share one `AWB#`/`Sample Ref` — decide and
document whether each ID number is its own row (recommended) or grouped. Re-run seed; confirm counts
and 0 dropped rows in `scripts/seed-report.json`.

### 3. Three tabs — extreme sort + filter + full CRUD (per table)
- Give each table its own REST endpoints, e.g. `/specialty-samples`, `/bulk-samples`,
  `/forwarding-samples`, each with **list** (whitelisted `sort` + `order` over every column of that
  table; rich filters — text search, date ranges, courier, result, country, sample_type,
  moisture/water-activity for bulk, has-AWB, etc.), **get :id** (+ its events), **create**, **update**,
  **delete**. `DELETE` should preserve the audit trail (soft-delete or a recorded `deleted` event —
  don't silently drop event rows). Keep the `{ data, total }` + windowed `count(*) OVER ()` contract
  and UUID-400 validation.
- **UI:** three tabs (Sample / Bulk / Forwarding). Each is a Twenty-style record table showing
  **exactly that table's columns** (per the Appendix), with per-column sort, a filter bar,
  pagination, inline/row create + edit + delete, and a detail view with the event timeline.

### 4. Clients section
- Full CRUD on clients + contacts (add `DELETE`; `PATCH` exists). Add pagination + whitelisted sort
  (by name, country, **and by latest order date** — computed across the three sample tables), plus
  search.
- **Add an "account owner" concept** — the Sucafina person interacting with each client. Schema has
  none today; add `clients.account_owner` (or a `traders`/`users` table + FK if you prefer). This is
  NEW data (not in the workbook) — the agent/dashboard populate it.
- Client detail page: contacts, the account owner, and that client's orders **from all three tables**
  (union by `client_id`, sortable by order date etc.). `GET /clients/:id` should include them.

### 5. Dashboard
- KPI tiles PLUS charts/visuals, aggregating **across all three tables**: volume over time, by
  status, by sample type, by courier, by country/client, dispatch throughput, awaiting-results
  aging, per-tab breakdowns. Add whatever aggregation endpoints you need. Make it genuinely
  impressive and immediately readable.

### 6. Agent: data-in with a warm, guaranteed-completeness flow
- Today the intake persona MINIMIZES questions ("ask exactly ONE short question… do not ask about
  anything else"). **Reverse the intent, but keep the tone friendly.** The agent ensures every
  record is COMPLETE and correctly slotted before writing — while feeling like a helpful colleague,
  never an interrogation:
  - Ask for missing fields **conversationally, one step at a time**, in a natural flow. Don't dump a
    form or fire a checklist. Acknowledge what the user gave, then ask for the next gap warmly
    ("Got it — AB FAQ for Beyers. Which courier is this going by?").
  - Use sensible defaults to avoid needless questions (offer 200g, type 300g, PSS 1kg), and only ask
    when something genuinely required for that section is missing or ambiguous.
  - Reject/redirect gibberish gently and never let a value land in the wrong field.
  - Before writing, **echo the assembled record back for a quick confirm** in the team's compact
    style, then create it. Keep the existing chat-native, warm-professional persona voice.
- **The agent routes to the right table first.** Every intake begins by establishing which of the
  three record types this is (Specialty / Bulk / Forwarding), then follows that table's required
  fields (see Appendix). Add per-table create/update tools — Bulk and Forwarding intake don't exist
  yet (only specialty-style). Keep everything going through the API; keep actor stamping + timeline.
- Keep data-OUT tools (search / status / tracking) working across all three tables.

## UI inspiration — Twenty CRM
Mirror Twenty's product feel and interaction patterns (do NOT copy code wholesale; respect their
license — use it as reference for UX and design-system quality):
- **Docs / concepts:** https://docs.twenty.com/llms.txt
- **Codebase:** https://github.com/twentyhq/twenty/tree/main/packages
Patterns worth borrowing: spreadsheet-like **record tables** with inline editing and column
customization; **filter / sort / group** controls as dropdown chips; **kanban/board** and
**calendar** views where they fit (e.g. samples by status, or by dispatch/delivery date);
**record detail pages** with tabs + contextual related-record widgets (a record's event timeline, a
client's orders); a customizable **left-nav** with saved views + favorites; a **Cmd+K command menu**
for quick actions; clean typography and spacing. Aim for that level of polish and simplicity.

## Constraints / conventions to preserve
- API stays the single writer; actor on every mutation; append an event row.
- `{ data, total }` on all lists; UUID validation → 400; server-issued refs where refs are issued;
  tracking stays simulated (swappable `TrackingProvider`).

## Decisions to confirm with me before/while building
1. Forwarding: one row per ID number vs. grouped-by-AWB.
2. Delete semantics: soft-delete vs. hard-delete-with-recorded-event.
3. Account owner: free-text field vs. a proper `traders`/`users` table.
4. Events: one polymorphic `events` table vs. per-table event tables.

## Acceptance
- Three separate tables, one per sheet, each with exactly its sheet's columns; all 4 sheets fully
  represented (0 dropped rows), Forwarding included.
- Three tabs, each backed by its own table, fully sortable/filterable with full CRUD; Clients
  section with account owner + order-date sort + client→orders drill-down across all three tables; a
  metrics/charts dashboard; Twenty-grade cosmetics.
- Agent routes to the correct table and creates valid, complete records for each type via a warm
  conversational flow, and reads them back.
- Single-writer rule, audit trail, and actor stamping intact.

---

## Appendix — the three tables (columns = exact sheet columns, in display order)
**(NEW vs. legacy `samples`)** just flags columns the old model dropped; here every column is real.
Where useful, add an optional typed companion column for sort/filter (noted), but always display the
source column on the tab.

### `specialty_samples` — Sample tab (`Specialty Samples 2024-2025`)
`date`, `ref`, `outturn`, `name`, `grade`, `bags`, `description`, `receiver_company`, `awb`,
`courier`, `qty`, `delivery_date`, `result`, `comments`, `crop_year`, `crop_area_details`
+ system: `id`, `client_id?`, `status`, `created_at`, `updated_at`.
- Required to create: `description`/quality + sample type (inferred from description) + `receiver_company`.
- Typed companions (optional): `qty_grams`, `courier_norm`, `requested_at`/`delivered_at` as dates.

### `bulk_samples` — Bulk tab (`BulkSamples 2024-2025`)
`date`, `sample_ref`, `bags`, `quality`, `client_ref`, `ico_mark`, `sample_type`, `client`,
`country`, `awb`, `courier`, `qty`, `moisture`, `water_activity`, `delivery_date`, `result`,
`comments`, `crop_year`, `crop_area_details`
+ system: `id`, `client_id?`, `status`, `created_at`, `updated_at`.
- Required to create: `quality` + `sample_type` + `client`.
- Typed companions (optional): `qty_grams`, `courier_norm`, dates.

### `forwarding_samples` — Forwarding tab (`E A Forwarding 2024-2025`)
`date`, `sender`, `origin`, `sample_ref`, `coffee_quality`, `receiver_company`, `id_number`, `awb`,
`courier`, `qty`
+ system: `id`, `client_id?`, `status`, `created_at`, `updated_at`.
- Required to create: `sender` + `origin` + `sample_ref` + `coffee_quality` + `receiver_company` + `id_number`.

### Clients section — `Client Details` (existing `clients` / `client_contacts`)
| Excel column | DB field |
|---|---|
| (company name, col A) | `clients.name` |
| Attention To: | `client_contacts.attention_to` |
| Full Address | `client_contacts.full_address` |
| Phone no. | `client_contacts.phone` |
| Email Address. | `client_contacts.email` |
| — (NEW, not in workbook) | `clients.account_owner` — the Sucafina person handling the client |
