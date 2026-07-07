# Sample Management Agent — Design

**Date:** 2026-07-07
**Project:** Lua AI × Sucafina, Phase 1 prototype (use case #3, "Quality: Sample Management Agent")
**Status:** Approved design, pending implementation plan

## 1. Problem

Sucafina Kenya's (Kenyacof) quality/lab team in Thika dispatches ~2,300 coffee samples a year to traders and clients worldwide. The workflow lives in a Teams group chat and a manually-maintained Excel ("Sample Chaser"):

- Traders request samples in free-text chat; requests arrive incomplete and sometimes fall through the cracks (a 30 Apr request resurfaced 3 Jun with "there was no prior instruction").
- QC dispatches via DHL/FedEx/local rider and pastes AWB numbers into chat; someone re-keys them into Excel.
- Status chasing is constant ("Sample PSS 3 to China sent? Did you share AWB?").
- The loop almost never closes: in the 2025–26 Sample Chaser, the **Result column is 0.0% filled** on the Specialty sheet (4.9% on Bulk) and **Delivery date only 24–38% filled**.

## 2. Goal

A working prototype that demonstrates, with the team's real data, an AI agent acting as the system of record and coordinator for the sample lifecycle:

**request → prepare → dispatch → deliver → results**

Success = the go/no-go demo lands: a trader logs a request by chat, QC logs dispatch by chat, the dashboard reflects it live, the morning chaser flags what's overdue, and cupping results get captured — no spreadsheet touched.

### Non-goals (prototype)

- MS Teams channel (no native Lua support; post-go/no-go via a custom HTTP-API bridge)
- Real DHL API integration (stubbed behind an interface; swap in when an account exists)
- Auth/multi-user roles on the dashboard (single shared API key)
- Migrating/fixing all historical data perfectly (seed is best-effort, raw values preserved)

## 3. Architecture

Monorepo, three runtime pieces + Postgres:

```
Sucafina/
├── src/                  # Lua agent — skills, tools, daily job, persona
├── api/                  # Node/Express REST API (only gateway to Postgres)
├── dashboard/            # Vite + React mini-CRM; embeds Lua chat widget
├── scripts/seed/         # xlsx → Postgres seeding (tolerant parsers)
└── docker-compose.yml    # postgres + api
```

- **Postgres (Docker, local)** is the system of record. Plain SQL schema — portable 1:1 to Azure Database for PostgreSQL, which mirrors Sucafina's Azure-centric stack.
- **The API is the single write path.** Both the dashboard and the agent's tools call it; nothing touches the DB directly. Later, "point the agent at the client's real system" = reimplement the API layer only.
- **The Lua agent runs in Lua's cloud** and cannot see localhost: the API is exposed through a tunnel (cloudflared/ngrok) and the base URL + API key are injected via Lua environment variables (`API_BASE_URL`, `API_KEY`). Local `lua test` runs can use `http://localhost:4000` directly.
- **The dashboard** is a local SPA calling the same API, with the Lua website chat widget embedded so chat and CRM are one screen in the demo.

## 4. Database schema

Informed by a full data-quality pass of the real Sample Chaser workbook (1,063 Specialty rows, 1,237 Bulk rows, 298 client rows). Naming: snake_case, plural tables.

### `clients`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name | text not null | deduped: 298 raw rows → ~270 companies |
| country | text | normalized case ("KENYA"/"kenya" → "Kenya") |
| created_at / updated_at | timestamptz | |

### `client_contacts`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| client_id | uuid fk → clients | duplicates in the sheet are same company, different office/contact (e.g. 49th Parallel ×4) |
| attention_to | text | 88% filled in source |
| full_address | text | 98% filled — this is a physical-shipping address book |
| phone | text | |
| email | text | only 2.3% filled in source; nullable |

### `samples`
| column | type | notes |
|---|---|---|
| id | uuid pk | DB identity; refs are NOT unique in real data |
| ref | text | agent-issued clean ref for new records (SL-nnnn / TYPE-nnn / SSKE-nnnnn[-A]) |
| ref_raw | text | original spreadsheet value, preserved verbatim |
| source_sheet | text | 'specialty' \| 'bulk' \| 'agent' (created via agent/dashboard) |
| sample_type | enum | offer, type, pss, woc, retention, flavor_mapping, marketing, calibration, other — parsed from 80 raw variants |
| shipment_month | text nullable | extracted from e.g. "PSS April Shipment" |
| quality | text | e.g. "AB FAQ", "AAA Nespresso Quality EUDR" |
| grade | text nullable | AA, AB, PB, C, NH, TT… (Specialty sheet) |
| outturn | text nullable | e.g. 08KN0061 (Specialty) |
| mark_name | text nullable | washing station/mark, e.g. KIANGOI/KIRINYAGA |
| ico_mark | text nullable | Bulk sheet |
| client_ref | text nullable | client's own reference (Bulk) |
| bags | integer nullable | lot size |
| qty_grams | integer nullable | parsed: bare number = grams, "1KG"→1000, "500g"→500 |
| qty_raw | text | original value ("60+roast" etc.) |
| client_id | uuid fk nullable | resolved where possible |
| receiver | text | raw receiver/company string (covers internal receivers like "sucafina NV", "Muki") |
| requester | text nullable | trader who asked (new records) |
| deadline | date nullable | |
| roast_instructions | text nullable | e.g. "100g roasted at 14% development" |
| status | enum | requested → preparing → dispatched → delivered → results_in; + cancelled |
| courier | enum nullable | dhl, fedex, ups, rider, hand_delivery, client_pickup, other — normalized from 19 raw spellings (KIPTOO/Kiptoo → rider) |
| courier_raw | text nullable | original spelling preserved |
| awb | text nullable | tracking number |
| requested_at / dispatched_at / delivered_at | timestamptz nullable | |
| result | enum nullable | approved, rejected, pending_feedback |
| cupping_notes | text nullable | free text ("83p, citrus driven, clean") |
| comments | text nullable | |
| crop_year | text nullable | |
| created_at / updated_at | timestamptz | |

### `sample_events`
Append-only audit trail powering the CRM timeline and the chaser.

| column | type |
|---|---|
| id | uuid pk |
| sample_id | uuid fk → samples |
| type | enum: requested, status_change, dispatched, delivery_update, result_logged, chased, note, edited |
| note | text |
| actor | text ("agent:chat", "dashboard", "job:chaser", or a person's name when known) |
| created_at | timestamptz |

Historical seeded rows get a synthetic `requested` event (+ `dispatched` where AWB present) so timelines aren't empty.

## 5. REST API (`api/`, Express + node-postgres, Dockerized)

All endpoints require `X-Api-Key` header (single shared key, env-configured). JSON in/out.

- `GET /samples` — filters: `status`, `sample_type`, `client_id`, `q` (text search over ref/quality/receiver), `overdue=true`, `awaiting_results=true`, `date_from/to`; paginated
- `POST /samples` — create (agent intake or dashboard); issues next clean ref if none given
- `GET /samples/:id` — record + events
- `PATCH /samples/:id` — partial update; every change writes a `sample_events` row with `actor`
- `GET /samples/:id/events`
- `GET /clients` (`q` name search), `POST /clients`, `PATCH /clients/:id`, contacts nested (`GET/POST /clients/:id/contacts`)
- `GET /stats` — KPI tile payload: counts by status, overdue count, in-transit count, awaiting-results count, dispatched-this-week
- `GET /tracking/:awb` — **stubbed courier tracking**: deterministic fake state machine keyed on AWB (in_transit → delivered over time) so demos are repeatable; module interface `TrackingProvider` allows a real DHL implementation later
- `GET /chaser/digest` — the current digest (what the job produced) for the dashboard's Chaser page
- `POST /chaser/run` — triggers digest computation (used by the LuaJob and a dashboard "run now" button)

Digest computation lives in the API (SQL), not the agent — the LuaJob calls it and formats/delivers the result.

## 6. Lua agent (`src/`)

### Skills & tools

All tools are thin HTTP clients of the API with zod-validated inputs.

**Skill: `sample-intake`**
- Tools: `create_sample_request`, `find_client` (ref issuance happens server-side in `POST /samples`)
- Trader writes: *"Can you send AB FAQ, ABC FAQ, Heavy Mbuni type samples to Thomas Pitault at Beyers?"* → agent resolves client (fuzzy name match via `GET /clients?q=`), creates **one record per sample**, echoes a compact confirmation table with refs.
- Missing required info → **one** short clarifying question (mirrors real chat: "Hi Omar, as Types?"). Required: quality, client/receiver, sample type. Optional-with-defaults: qty (by type: offer 200g, type 300–500g, PSS 1kg), deadline, roast instructions.

**Skill: `dispatch-logging`**
- Tools: `find_open_samples`, `record_dispatch`
- QC writes: *"dispatched samples to Key coffee tracking details :872526345980 Fedex"* → agent matches open requests for that client, records courier+AWB on all matched records (asks if the match is ambiguous), flips status to `dispatched`.

**Skill: `status-and-tracking`**
- Tools: `search_samples`, `get_sample_status`, `track_awb`
- Answers: "did the Folgers samples go out?", "AWB for the Beyers types?", "will China's PSS arrive on time?" (via tracking stub), "what's pending for Zoegas this year?" (counts/summaries).

**Skill: `results-capture`**
- Tools: `record_result`, `list_awaiting_results`
- *"PSS3 cupped 83, citrus driven, clean — approved"* → stores result + cupping notes, status → `results_in`. Also answers "what's awaiting feedback?"

**Skill: `client-book`**
- Tools: `find_client`, `add_or_update_client`
- "what's Beyers' address?" / "new client Brew and Beyond, Loresho, contact …" — reads and writes the address book.

### Job: `daily-chaser` (LuaJob, weekday mornings EAT)

Calls `POST /chaser/run` then formats the digest:
1. **PSS first** (high-stakes per chat evidence), then type/offer samples
2. Buckets: (a) requested but not dispatched past deadline (or >3 days with no deadline), (b) dispatched >5 days, no delivery confirmation, (c) delivered >7 days, no result
3. Digest is persisted (dashboard Chaser page) and sent through the agent's channel (proactive message in web chat for the demo)

### Persona

Rewritten from the real Teams chat. Key traits baked in:
- Identity: sample-management coordinator for the Kenyacof quality/trade team
- **Chat-length replies** — short, warm-professional; "well noted"-style confirmations; no corporate fluff, no over-explaining
- Speaks the team's jargon natively: PSS, Types, FAQ, AWB, outturn, cupping, bulk, boxes
- Always confirms actions with a compact structured echo (ref, quality, client, qty, status)
- One clarifying question max when info is missing; sensible defaults otherwise
- Understands both audiences: traders (requests, chasing, summaries) and QC (dispatch logging, results)
- Never invents AWBs/statuses; if the DB doesn't know, it says so and offers to chase
- Example dialogues in the persona are lifted from real chat exchanges (Beyers types request, Key Coffee dispatch, Folgers status check)

## 7. Dashboard (`dashboard/`, Vite + React + TypeScript)

Read **and write** mini-CRM. Pages:

1. **Samples** — KPI tiles (pending, in transit, awaiting results, overdue) + filterable/searchable table (status, type, client, date range). Row click → detail.
2. **Sample detail** — full record edit form, event timeline, tracking status (from stub), quick actions (mark dispatched w/ AWB, record result).
3. **Clients** — searchable address book, client detail with contacts, create/edit.
4. **Chaser** — latest digest grouped by bucket, "Run now" button.
5. **Chat widget** — Lua website widget docked on all pages (talk to the agent while looking at the data).

Edits from the dashboard write through the same API (`actor: "dashboard"`), so agent and human edits share one audit trail. Styling: clean light dashboard, no heavy framework — this is a demo, polish over feature count.

## 8. Seed (`scripts/seed/`)

TypeScript script, idempotent (`--reset` drops & reloads):
1. Parse `docs/Sample Chaser2025-2026 - Sample Chaser.xlsx` (openpyxl-equivalent in TS: `xlsx` package)
2. **Clients:** dedupe by normalized name → `clients` + one `client_contacts` row per source row
3. **Samples:** both sheets → union schema. Tolerant parsers: multi-format dates (`datetime` cells + `14/1/2025` strings), qty→grams, courier normalization map, sample-type classifier (80 raw values → enum + shipment_month), grade/quality split. Unparseable values: keep raw column filled, leave normalized column null — never drop a row.
4. Client resolution: fuzzy match receiver/client strings against deduped client names; unresolved → `client_id` null, `receiver` retains raw string
5. Status inference for historicals: AWB present → `dispatched`; delivery date → `delivered`; result → `results_in`; else `requested`
6. Synthetic `sample_events` rows so timelines render

## 9. Error handling

- API: zod-validated request bodies; 400 with field errors; 401 on bad key; DB errors → 500 with logged detail, generic message out
- Agent tools: API failures surface as honest "couldn't reach the tracker just now" messages, never invented data; ambiguous matches (multiple open samples for a client) → agent asks rather than guesses
- Seed: per-row try/catch; failures logged to a `seed-report.json` with row numbers; summary printed (rows loaded / skipped / warnings)
- Tunnel down: agent's tool error message tells the demo operator exactly what to restart

## 10. Testing

- **API:** integration tests (vitest + supertest) against a test Postgres (docker) — CRUD, filters, stats, digest buckets, tracking stub determinism
- **Seed:** unit tests for the parsers (qty, courier, sample-type, date) using real weird values from the workbook (`"60+roast"`, `"14/1/2025"`, `"KIPTOO"`, `"PSS JUNE SHIPMENT"`); full-run assertion on row counts (1,063 + 1,237 in, ≥95% loaded)
- **Agent:** `lua test` per tool with recorded fixtures; `lua chat` scripted conversation pass for the four demo scenarios (intake, dispatch, status, results)
- **Dashboard:** smoke-level — builds, renders each page against seeded API

## 11. Demo script (go/no-go session)

1. Dashboard open, seeded with the team's real 2025–26 data — "this is your Sample Chaser, alive"
2. In the widget as a trader: *"send AB FAQ and Heavy Mbuni type samples to Thomas at Beyers, needed Friday"* → two rows appear, refs issued
3. As QC: *"Beyers samples went out, DHL 9620551651"* → statuses flip, AWB logged
4. *"Where are the Beyers samples now?"* → tracking stub answers
5. Run chaser → digest shows real gaps in their real data (thousands of missing results/delivery dates)
6. *"PSS3 cupped 83, citrus, clean — approved"* → Result column finally gets filled
7. Close on `/stats` tiles: what management visibility looks like

## 12. Open items

- Tunnel choice at demo time (cloudflared quick tunnel vs ngrok reserved domain)
- Whether the chaser digest also goes to email (Lua email channel) for realism — decide during build
- Real DHL API credentials — post-go/no-go
- MS Teams bridge via Lua HTTP API — post-go/no-go
