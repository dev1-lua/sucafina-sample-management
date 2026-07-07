# Sample Management Rebuild — Twenty-CRM UI + three-table backend — Design

**Date:** 2026-07-08
**Project:** Lua AI × Sucafina — rebuild of the Sample Management prototype
**Branch:** `feature/sample-management-agent`
**Status:** Approved design, pending implementation plan
**Supersedes (UI):** the single-`samples`-table dashboard from `2026-07-07-sample-management-agent-design.md` (that legacy table stays in the DB, untouched — see §9)

---

## 1. Problem & goal

The current prototype merges two of the workbook's sheets into one unified `samples` table and surfaces them through a plain-HTML-table dashboard. We are rebuilding it into a **Twenty-CRM-style** product where the workbook's **three sample sheets become three dedicated tables and three dedicated tabs**, each holding *exactly* its source sheet's columns, plus a **Clients** section and a **Dashboard** of cross-table metrics. The AI agent is upgraded from a question-minimizing intake into a **warm, guaranteed-completeness** intake that routes each request to the correct table and writes only complete, correctly-slotted records.

The invariants of the existing system are preserved verbatim: **the API is the single writer**, every mutation is **actor-stamped into an event log**, lists return **`{ data, total }`** via a windowed `count(*) OVER ()`, `:id` params are **UUID-validated → 400**, refs are **server-issued**, and courier **tracking stays simulated** behind a swappable provider.

**Success =** three tables (one per sheet, exact columns, 0 dropped rows incl. Forwarding); three fully sort/filter/CRUD tabs; a Clients section with account-owner + order-date sort + cross-table drill-down; a metrics/charts dashboard; a Twenty-grade look pinned to concrete design tokens; and an agent that routes to the right table and creates complete records via a warm conversational flow — with the single-writer rule, audit trail, and actor stamping intact.

### Non-goals (prototype)
- No dashboard auth/SSO (single shared API key, as today).
- No real courier API (simulated `TrackingProvider`, as today).
- No fabricated business data: account owners are **seeded-but-unassigned**, and client links stay **honest-sparse** (no derived client stubs). See §8.
- Tier-3 UI features (calendar view, server-persisted saved views, per-user favorites) are explicitly **out** (see §7).

---

## 2. Source data (verified against the workbook, not assumed)

`docs/Sample Chaser2025-2026 - Sample Chaser.xlsx`, 4 sheets:

| Sheet | Non-empty data rows | Becomes |
|---|---|---|
| `Specialty Samples 2024-2025` | **1,063** | `specialty_samples` → Sample tab |
| `BulkSamples 2024-2025` | **1,237** | `bulk_samples` → Bulk tab |
| `E A Forwarding 2024-2025` | **15** | `forwarding_samples` → Forwarding tab (currently **not ingested**) |
| `Client Details` | **298** (→ **270** clients after case-dedup) | `clients` / `client_contacts` |

Verified quirks that shape the design:
- Bulk's country header is `"Country "` (trailing space); `Client Details` column A has a **null header** (it is the company name — seed already handles this).
- Bulk `Sample Type` is free text (`"Offer sample"`, `"TYPE SAMPLE"`) → kept verbatim + a typed companion.
- **Forwarding grouping (settles decision #1):** 15 rows = **4 AWBs / 4 Sample Refs**; one shipment (`SSUG-97043` / AWB `Y0231587736`) spans **9 `ID Number` parcels** (`UGF/25/015…023`). Some rows have **no `id_number` and no `sample_ref`** (the two Illy/DHL rows); `id_number` `UGF/25/028` **appears twice** (not unique). → We store **one row per ID number**, all source columns **nullable**, `id_number` **not unique**.

---

## 3. Decisions (locked)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Forwarding granularity | **One row per ID number** | Preserves all 15 source rows verbatim (0 dropped); AWB/Sample Ref repeat across parcels. |
| 2 | Delete semantics | **Soft-delete** (`deleted_at`) + recorded `deleted` event | Preserves the ledger; reversible; avoids orphaning polymorphic events. |
| 3 | Account owner | **`traders` table + `clients.account_owner_id` FK** | Enables owner filter/sort, a picker, and a "by owner" dashboard cut. |
| 3a | Account-owner seeding | **Seed traders (from persona names), leave clients unassigned** | Not in the workbook; don't fabricate assignments. Agent/dashboard populate over time. |
| 4 | Events shape | **One polymorphic `events` table** | Uniform timeline queries + a client's cross-entity activity feed in one query. |
| 5 | Client linking | **Honest-sparse** (only real `Client Details` matches link; no derived stubs) | Don't fabricate client rows. Big unlisted receivers (JDE/Nestrade/Sucafina NV) stay unlinked, as in reality. |
| 6 | Coexistence | **New app replaces the UI**; Dashboard/stats/chaser read the 3 new tables via `all_samples_v`; legacy `samples` stays in the DB untouched but unused by the UI | One coherent product; no dual sources of truth in the UI. |
| 7 | Polish scope | **Tier 1 (must) + Tier 2 (stretch)**; Tier 3 out | Gives "Twenty-grade" a defined "done" (see §7). |
| 8 | Frontend stack | **shadcn/ui (Radix+Tailwind) + TanStack Table/Virtual/Query + Framer Motion + cmdk + Recharts + Tabler Icons** | Closest primitive match to Twenty, full styling control, no lock-in. |
| 9 | Backend route shape | **Shared helpers + explicit per-table routes** | One correct impl of the cross-cutting contracts; per-table columns/filters stay local and readable. |

**Implications of the honest-data choices (expected, not bugs):** account-owner views and the big-client cross-table drill-downs start empty and fill in as the agent/dashboard assign owners and link clients.

---

## 4. Data model (migration `002_*.sql`)

Naming: snake_case, plural tables. All three sample tables share the **system columns**: `id uuid PK`, `client_id uuid NULL → clients(id)`, `status`, `deleted_at timestamptz NULL`, `created_at`, `updated_at`. All **source columns are nullable** (seed fidelity); "required" is enforced only at the agent write-boundary (§6). Each table displays its **source columns verbatim**; typed **companion columns** exist only for sort/filter and are never shown as the primary cell.

### 4.1 `specialty_samples` — Sample tab
Source columns (verbatim, display order): `date, ref, outturn, name, grade, bags, description, receiver_company, awb, courier, qty, delivery_date, result, comments, crop_year, crop_area_details`.
Typed companions: `date_on date`, `delivery_on date`, `qty_grams int`, `courier_norm courier_t`, `result_norm result_t`, `sample_type_norm sample_type_t` (inferred from `description`).

### 4.2 `bulk_samples` — Bulk tab
Source columns: `date, sample_ref, bags, quality, client_ref, ico_mark, sample_type, client, country, awb, courier, qty, moisture, water_activity, delivery_date, result, comments, crop_year, crop_area_details`.
Typed companions: `date_on`, `delivery_on`, `qty_grams`, `courier_norm`, `result_norm`, `sample_type_norm`, `moisture_pct numeric`, `water_activity_num numeric` (for range filters).

### 4.3 `forwarding_samples` — Forwarding tab
Source columns: `date, sender, origin, sample_ref, coffee_quality, receiver_company, id_number, awb, courier, qty`.
Typed companions: `date_on`, `qty_grams`, `courier_norm`.
**Reduced lifecycle:** `requested → dispatched → delivered` (never `results_in`; no cupping result exists). Reuses `sample_status_t` but simply never reaches `results_in`.

### 4.4 `events` — polymorphic audit log (new; legacy `sample_events` untouched)
`id uuid PK`, `entity_type entity_type_scope` (`'specialty' | 'bulk' | 'forwarding' | 'client'`), `entity_id uuid`, `type entity_event_t`, `note text`, `actor text NOT NULL`, `created_at timestamptz`. Index: `(entity_type, entity_id, created_at)`.
`entity_event_t` enum: `created, edited, status_change, dispatched, delivery_update, result_logged, chased, note, deleted, restored`. No FK (standard for polymorphic logs); integrity enforced at the app layer via `mutateWithEvent` (§5).

### 4.5 `traders` (new) + `clients` changes
`traders`: `id uuid PK`, `name text UNIQUE`, `email text NULL`, `role text CHECK (role IN ('trader','qc'))`, `active bool DEFAULT true`, `created_at`.
`clients` adds: `account_owner_id uuid NULL → traders(id)`, `deleted_at timestamptz NULL`.

### 4.6 `all_samples_v` (read-only view — the cross-table backbone)
`UNION ALL` of the three tables into a common projection:
`tab ('specialty'|'bulk'|'forwarding'), id, ref (ref|sample_ref|sample_ref), title (description|quality|coffee_quality), receiver (receiver_company|client|receiver_company), country (NULL|country|origin), client_id, status, courier_norm, awb, qty_grams, date_on, delivery_on (NULL for fwd), result_norm (NULL for fwd), created_at, deleted_at`.
Consumers filter `deleted_at IS NULL` unless they explicitly want deleted rows. The **`tab` discriminator is how the agent routes a write back to the correct base table** after a cross-table read.

---

## 5. API

Express/ESM/`pg`, existing conventions preserved. Legacy `/samples` stays mounted and untouched.

### 5.1 Shared helpers (`api/src/lib/`)
- `list.ts` — `buildList({ table, columns, sortable, filters, search })`: whitelisted `sort`+`order` over every column, filter clauses, `{ data, total }` via `count(*) OVER ()`, pagination, default `deleted_at IS NULL`. One correct implementation of the list contract.
- `mutate.ts` — `mutateWithEvent(entityType, entityId, changes, { actor, eventType, note })`: single-writer update/insert + a polymorphic `events` append in the same path. The **only** way routes write, so every mutation is audited.
- `validate.ts` — `parseId` (UUID → 400) shared across routes.

### 5.2 Per-table routes (explicit, thin — wire columns + filters, call the helpers)
`/specialty-samples`, `/bulk-samples`, `/forwarding-samples`, each:
- `GET /` — list; whitelisted sort over **every** column (sort targets the typed companion for date/qty/courier); filters: text search, date ranges (`date_on`/`delivery_on`), `courier_norm`, `result_norm`, `country`, `sample_type_norm`, `has_awb`; **Bulk** adds `moisture_pct`/`water_activity_num` ranges; **Forwarding** adds `has_id`, `origin`, `sender`.
- `GET /:id` — row + its `events[]`.
- `POST /` — create (server-issues a ref where refs are issued); writes a `created` event.
- `PATCH /:id` — update; writes `status_change`/`dispatched`/`result_logged`/`edited` (derives `results_in` when a result is set, except Forwarding).
- `DELETE /:id` — **soft-delete** (`deleted_at = now()`) + `deleted` event.

### 5.3 Clients & traders
- `GET /clients` — search + pagination + whitelisted sort by `name`, `country`, and **`latest_order_date`** (computed across the three tables via `all_samples_v`).
- `GET /clients/:id` — contacts + `account_owner` (joined trader) + **orders from all three tables** (union via the view, sortable by order date) + the client's `events[]`.
- `POST /clients`, `PATCH /clients/:id` (incl. `account_owner_id`), **`DELETE /clients/:id`** (soft-delete + event), contacts CRUD.
- `GET /traders`, `POST /traders` — the owner-picker source; agent/dashboard populate.

### 5.4 Aggregation / read
- `GET /stats` — **rewritten** to aggregate across `all_samples_v`: `by_status`, `by_tab`, `by_sample_type`, `by_courier`, `by_country`/`by_client`, volume-over-time, awaiting-results aging buckets, dispatch throughput.
- `GET /search` — unified cross-tab read for the agent; returns `tab`+`id` on every hit (for write-routing).
- `GET /tracking/:awb` — unchanged behavior; AWB lookup repointed to `all_samples_v`.
- `GET /chaser/digest`, `POST /chaser/run` — `computeDigest` repointed to `all_samples_v` (Forwarding excluded from the awaiting-results bucket); `chased` events written to the polymorphic `events` table with the correct `entity_type`.

---

## 6. Agent (data-in + data-out)

Model unchanged (`anthropic/claude-sonnet-5`); everything still through the API via `apiFetch` (actor `agent:chat`).

### 6.1 Table routing (do this first, every intake)
Each intake skill's `context` carries strong distinguishing signals so the model routes confidently:
- **Specialty** — grade / outturn / bags / a `Name` mark; roasted or green specialty samples.
- **Bulk** — moisture / water-activity / ICO mark / client-ref / a `Client` + `Country`.
- **Forwarding** — Kenyacof re-forwarding a shipment from an `origin` with per-parcel `ID Number`s.
A single **warm disambiguation question** ("Specialty, bulk, or a forwarding shipment?") only when signals are absent or conflicting.

### 6.2 Guaranteed completeness (the reliability guarantee — two layers)
- **Write-boundary (hard):** three create tools — `create_specialty_sample`, `create_bulk_sample`, `create_forwarding_sample` — whose **Zod schemas hard-require that table's required fields**, so an incomplete record literally cannot be written (the tool errors; the model must gather more). Required sets:
  - Specialty: `description`/quality + `sample_type` (inferred) + `receiver_company`.
  - Bulk: `quality` + `sample_type` + `client`.
  - Forwarding: `sender` + `origin` + `sample_ref` + `coffee_quality` + `receiver_company` + `id_number`.
- **Conversation (warm):** persona/skill context drives the gathering — acknowledge what was given, ask the **next single gap** warmly, use sensible defaults (offer 200g / type 300g / PSS 1kg) to avoid needless questions, reject/redirect gibberish gently, **echo the assembled record** in the team's compact style, get a quick confirm, then write.

### 6.3 Persona rewrite
Keep the warm-professional, chat-native voice and jargon; **reverse the intent** from "ask exactly ONE question and stop" to "ensure the record is complete and correctly slotted, one gentle step at a time." Confirmation echo before every create.

### 6.4 Per-table updates & data-out
- Per-table update tools (take `tab`+`id`); dispatch-logging and results-capture find the record via `/search` (which returns `tab`+`id`) then PATCH the correct table. Forwarding has no results-capture path.
- `search` / `get_status` / `list_awaiting_results` / `track_awb` repointed across all three tables via `/search` + `/tracking`.
- Legacy `create_sample_request` (writes legacy `samples`) is **retired from the active skill set**.
- Daily chaser job wiring unchanged; its digest is now cross-table.

---

## 7. Frontend — Twenty-grade UI

Stack: **shadcn/ui (Radix + Tailwind)** components, **TanStack Query** (over the existing `api()` helper, keeping `x-actor: dashboard`), **TanStack Table + Virtual** (server-driven sort/filter/pagination honoring the whitelists; virtualized for 1k+ rows; inline-edit cells → PATCH with optimistic update + invalidate), **Framer Motion** (drawer/route/stagger motion), **cmdk** (Cmd+K), **Recharts** (charts, guided by the `dataviz` skill), **Tabler Icons**.

### 7.1 Design language / tokens (a build requirement, not a vibe)
Calibrate a **Twenty-flavored `tailwind.config`** and restyle the shadcn primitives (stock shadcn looks generic — this is the work), verified against Twenty's `twenty-ui` theme at build time (inspiration only; no code lifted, license respected):
- **Foundation:** light, airy, low-chrome; near-white surfaces; **1px hairline borders** over shadows; minimal elevation; **4px spacing grid**; radii 4px (controls) / 8px (cards, modals); **dark mode** via theme tokens.
- **Typography:** **Inter**, ~13px base, tight line-height; small muted uppercase-ish column headers; medium-weight section titles.
- **Color:** neutral gray scale + **one blue accent used sparingly** + Twenty's **multi-color tag system** (~10 label colors) for statuses / sample types / tags.
- **Tables:** spreadsheet-like, **~32px rows**, hover + subtle blue selection, inline edit, hairline separators, high density.
- **Chrome:** collapsible **left sidebar** (sections + favorites + workspace header); **filter/sort/group as small pill dropdowns** with icons; **Cmd+K**; record detail as a **right-side peek drawer** + full show-page with tabs + related-record sections; **rounded avatar initials** for people (account owner / traders).
- **Motion:** restrained — drawer peek slide-in, row/stagger on load, chart mount, ~150–200ms eased.

### 7.2 App structure
- Shell: left nav (Dashboard · Sample · Bulk · Forwarding · Clients) + Cmd+K + brand; theme toggle.
- Shared components: `RecordTable`, `FilterBar` (chips), `DetailDrawer` (tabs: Details / Timeline / Related), `Timeline` (events), `StatusBadge`/tag pills, `KpiTile`, chart components.
- Routes: `/` (Dashboard), `/samples` (specialty), `/bulk`, `/forwarding`, `/clients`, `/clients/:id`. Row click → detail drawer; deep-linkable.

### 7.3 Polish tiers (defines "done")
- **Tier 1 (must):** record tables w/ per-column sort + inline edit; filter/sort dropdown chips; detail drawer w/ Details/Timeline/Related; left nav; Cmd+K; the design-token pass.
- **Tier 2 (stretch):** samples-by-status **kanban** (`/board`); saved views (localStorage); column show/hide.
- **Tier 3 (out):** calendar view; server-persisted saved views; per-user favorites.

---

## 8. Seed & migration

Extend `scripts/seed/run.ts` (reusing the tested pure parsers in `parsers.ts`):
- Load `clients` / `client_contacts` as today (**honest-sparse** linking via existing `resolveClient`; **no derived stubs**).
- Load `traders` from the persona's known names (traders: Ivo, Omar, Muki, Brian, Gloria; QC: Bernard, Brillian, Harriet, Anička), roles set, **`clients.account_owner_id` left NULL**.
- Load `specialty_samples` (1,063), `bulk_samples` (1,237), `forwarding_samples` (15) — source columns verbatim + typed companions; **one Forwarding row per ID number** (null-id rows kept). Emit one `created` event per row (actor `seed`).
- Legacy `samples` load stays exactly as-is (it is FK-entangled with `clients`, so the reseed reloads it unchanged — "untouched" = same schema, same loader, same data).
- Extend `seed-report.json` with per-table counts; assert **1063 / 1237 / 15 / 270** and **0 dropped rows**.

Migration `002_*.sql` adds: the three tables + indexes, `entity_type_scope`/`entity_event_t` enums, `events`, `traders`, `clients.account_owner_id` + `clients.deleted_at`, and the `all_samples_v` view. Legacy objects are not altered.

---

## 9. Coexistence & sequencing

**Coexistence:** legacy `samples` + `sample_events` + `/samples` route remain in place and untouched; the new UI, new agent tools, and new aggregations use the three new tables + `all_samples_v`. No UI reads legacy `samples`.

**Build order (each phase becomes its own implementation plan):**
1. **DB + seed** — migration `002`; extend seed (3 sheets incl. Forwarding, traders); verify counts / 0 dropped.
2. **API** — shared helpers → 3 resource routers → clients upgrades (DELETE, pagination, latest-order sort, cross-table drill-down) → `/traders` → `/stats` + `/search` + `/tracking` + `/chaser` on the view.
3. **FE foundation** — Tailwind/shadcn + token pass; TanStack Query; app shell + Cmd+K; shared `RecordTable`/`FilterBar`/`DetailDrawer`/`Timeline`.
4. **FE features** — three tabs → Clients + drill-down → Dashboard charts. Tier-2 stretch if time.
5. **Agent** — three create/update tools (hard-required schemas) + routing + warm persona rewrite + data-out repoint; retire legacy intake tool.
6. **E2E** — reseed, smoke both front doors (dashboard CRUD + agent chat intake per table), update `ARCHITECTURE.md` / `DEMO.md`.

---

## 10. Risks & mitigations
- **Honest-data emptiness** (owner views, big-client drill-downs start empty) — expected; documented in DEMO so it reads as a deliberate ledger, not a gap.
- **Forwarding `qty` is null in all 15 source rows** — column renders empty; `qty_grams` null. Fine (verbatim fidelity).
- **`all_samples_v` heterogeneity** (Forwarding lacks result/moisture/delivery) — projected as NULL; dashboard buckets that don't apply to Forwarding exclude it explicitly.
- **"Twenty-grade" scope creep** — bounded by the Tier 1/2/3 split and the token acceptance in §7.1.
- **Grid perf on 1k+ rows** — server-driven pagination/sort/filter + TanStack Virtual; the DB does the work, the grid renders a window.

---

## 11. Acceptance
- Three tables, one per sheet, each with exactly its sheet's columns; all four sheets fully represented (**0 dropped rows**, Forwarding included, one row per ID number).
- Three tabs, each backed by its own table, fully sortable/filterable with full CRUD (soft-delete + event); a Clients section with account owner + order-date sort + client→orders drill-down across all three tables; a metrics/charts Dashboard; the Twenty design-token pass applied.
- Agent routes to the correct table and creates valid, complete records for each type via a warm conversational flow, and reads them back across all three tables.
- Single-writer rule, polymorphic audit trail, and actor stamping intact; legacy `samples` untouched.
