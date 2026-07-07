# Sucafina Sample Management Agent — How It All Works

A working prototype that turns coffee-sample tracking from a spreadsheet + Teams thread
into a live system with two front doors: a **CRM dashboard** and an **AI chat agent**.
Both sit on the same database, seeded with **real data** from the *Sample Chaser
2025–2026* workbook (~2,300 samples, ~270 clients, ~4,600 timeline events).

> For running a live demo, see **`DEMO.md`**. This document explains what the system is,
> how each piece works, and how they fit together.

---

## 1. What it does

Coffee traders request samples; a QC/lab team prepares and ships them; clients cup them
and give verdicts. This system keeps one accurate record per sample across that whole
lifecycle, and lets people drive it either by clicking (dashboard) or by typing in plain
English (agent). It also chases what's falling behind.

**Sample lifecycle:** `requested → preparing → dispatched → delivered → results_in`
(or `cancelled`).

---

## 2. Repository layout

The repo is **not** an npm workspace — it's three independent packages plus the agent,
each with its own `package.json`/`tsconfig` and dependencies:

| Path | What it is | Stack |
|---|---|---|
| `api/` | The Sample API + Postgres schema/migrations | Express, TypeScript (ESM, strict), `pg` |
| `scripts/` | The seeder that loads the Excel workbook into Postgres | TypeScript, `xlsx`, vitest |
| `dashboard/` | The CRM web app | Vite + React 18 + react-router-dom |
| `src/` | The Lua agent (persona, skills, tools, job) | lua-cli, Zod |
| `docs/` | Source workbook + design/spec/plan documents | — |
| `DEMO.md`, `ARCHITECTURE.md` | Runbook + this document | — |

`docker-compose.yml` runs **Postgres 16** on host port **5433**.
Root `package.json`/`tsconfig.json` belong to the lua-cli agent tooling and are
intentionally untracked.

---

## 3. Architecture & data flow

```
┌─────────────────────────── your machine ───────────────────────────┐
│                                                                     │
│  Browser  (dashboard @ localhost:5173)                              │
│    ├── CRM pages ───────────────────┐                               │
│    └── chat widget ──┐              │                               │
│                      │              ▼                               │
│                      │        Sample API (Express, localhost:4000)  │
│                      │              │                               │
│                      │              ▼                               │
│                      │        Postgres 16 (localhost:5433, seeded)  │
│                      │              ▲                               │
│                      ▼              │                               │
│         (browser → Lua cloud)   cloudflared tunnel ────────────────┘
│                      │              ▲
└──────────────────────┼──────────────┼──────────────────────────────
                       ▼              │
              Lua cloud agent ────────┘  (agent tools call API_BASE_URL = tunnel)
```

Two distinct network paths — this distinction is the thing people trip on:

1. **Browser → Lua cloud** — the chat widget (JS on the dashboard page) talks to the
   deployed agent in Lua's cloud. Gated by the agent's **Allowed-websites** whitelist
   (the page origin, `http://localhost:5173`).
2. **Lua cloud agent → your API** — when the agent runs a tool, it calls the Sample API
   at `API_BASE_URL`. Because the agent runs in the cloud, that must be a **public tunnel**
   to your local API, not `localhost`.

The dashboard's own CRM pages talk to the API directly (same machine), so they work with
no tunnel.

---

## 4. Data model

Postgres schema (`api/migrations/001_init.sql`). Five enums, six tables.

**Enums**
- `sample_type_t`: offer, type, pss, woc, retention, flavor_mapping, marketing, calibration, other
- `sample_status_t`: requested, preparing, dispatched, delivered, results_in, cancelled
- `courier_t`: dhl, fedex, ups, rider, hand_delivery, client_pickup, other
- `result_t`: approved, rejected, pending_feedback
- `event_type_t`: requested, status_change, dispatched, delivery_update, result_logged, chased, note, edited

**Tables**
- `clients` — company name (unique on `lower(name)`), country, timestamps.
- `client_contacts` — attention_to / address / phone / email, FK to `clients` (cascade).
- `samples` — the core record: refs, type, quality/grade/outturn, quantities, `client_id`
  + free-text `receiver`, requester, deadline, status, courier + `awb`,
  requested/dispatched/delivered timestamps, result + cupping notes. Indexed on ref,
  status, client_id, awb.
- `sample_events` — an append-only **timeline** per sample: `{type, note, actor, created_at}`.
  Every mutation writes one, tagged with **who did it** (`actor`).
- `ref_counters` — server-side ref issuance (`SL` from 8000, `TYPE` from 1000, `SSKE` from 108000).
- `chaser_digests` — persisted chaser snapshots (`payload jsonb`).

**The audit trail is the point:** nothing changes a sample without appending a
`sample_events` row naming the actor (`agent:chat`, `dashboard`, `job:chaser`, `api`, …).
That's what makes the timeline on the detail page trustworthy.

---

## 5. The API (`api/`)

Express, ESM, strict TypeScript, `pg` pool. Mounted in `api/src/app.ts`.

**Auth & headers:** every route except `/health` requires header `x-api-key`
(default `dev-key-sucafina`). Mutations read `x-actor` to stamp events. CORS is open for
the local dashboard (`x-api-key`, `x-actor` allowed).

**Endpoints**
| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness (`{ok:true}`), no auth |
| `GET /clients?q=` · `GET /clients/:id` · `POST /clients` | Client book (search, detail w/ contacts, create w/ optional contact) |
| `GET /samples` | List with filters: `q`, `status` (comma list), `sample_type`, `overdue`, `awaiting_results`, `page`, `pageSize` |
| `GET /samples/:id` | One sample + its `events[]` timeline |
| `POST /samples` | Create; issues a ref via `ref_counters`; writes a `requested` event |
| `PATCH /samples/:id` | Update; writes `status_change`/`dispatched`/`result_logged`/`edited` events; auto-derives `results_in` when a result is set |
| `GET /stats` | Dashboard tiles: by_status, overdue, in_transit, awaiting_results, dispatched_this_week |
| `GET /tracking/:awb` | Deterministic **simulated** courier status + ETA (hash of the AWB; no real courier API) |
| `GET /chaser/digest` · `POST /chaser/run` | Latest persisted digest; recompute + persist (writes `chased` events, PSS-first) |

**Conventions baked in across routes**
- List endpoints return `{ data, total }`, where `total` is the true match count via
  `count(*) OVER ()` (computed in-query, stripped from rows).
- `:id` params are validated as UUIDs up front (Zod) → `400`, so bad input never reaches
  Postgres as a `500`.
- Shared helpers: `HttpError`/`h()`/`parseBody` (`errors.ts`), `actorFrom(req)` (`auth.ts`).

---

## 6. The seed (`scripts/`)

Loads `docs/Sample Chaser2025-2026 - Sample Chaser.xlsx` into Postgres.

- `parsers.ts` — pure functions that turn messy spreadsheet cells into typed values
  (quantities → grams, dates, courier strings → enum, sample-type inference). Covered by
  `parsers.test.ts` (~60 tests).
- `run.ts` — reads the workbook, upserts clients + contacts, inserts samples, links
  samples to clients by name matching, and writes a `seed-report.json`.

**Result of the current seed:** 270 clients, 290 contacts, 2,300 samples (0 dropped),
~4,600 events, **487 sample→client links resolved**.

> **Known data gap (by design of the source workbook):** the highest-volume receivers
> (JDE, Nestrade, Sucafina NV) have **no Client Details rows** in the real workbook, so
> the name matcher can't link their samples to a client record — hence 487 resolved links
> rather than a higher figure. Those samples still exist with a free-text `receiver`;
> they're just not joined to a `clients` row. Fixable by auto-creating clients from
> receiver names if richer client joins are wanted.

---

## 7. The agent (`src/`)

A lua-cli agent, model `anthropic/claude-sonnet-5`. Everything it does goes **through the
API** via one helper — it never touches the database directly.

- **`src/lib/api.ts`** — `apiFetch(path, init?)`. Injects `content-type`, `x-api-key`,
  and `x-actor: agent:chat`, and throws on non-2xx. `API_BASE_URL` / `API_KEY` come from
  the agent's server-side env. This is why every agent action lands in the timeline as
  actor `agent:chat`.
- **`src/persona.ts`** — the "Kenyacof Sample Desk" persona: identity, business context,
  who it talks to (traders vs QC/lab), chat-native brief tone, jargon (PSS, Types, AWB,
  outturn, cupping), defaults (offer 200g / type 300g / PSS 1kg), and boundaries (logs &
  reports; doesn't price or approve).

**Five skills, ten tool files (12 tool instances):**

| Skill | Tools | What it handles |
|---|---|---|
| `sample-intake` | find_client, create_sample_request, upsert_client | Logging new requests with smart defaults |
| `client-book` | find_client, upsert_client | Look up / add clients & contacts |
| `dispatch-logging` | find_open_samples, record_dispatch | "sent to X, DHL 123…" → marks dispatched + AWB |
| `status-and-tracking` | search_samples, get_sample_status, track_awb | "did X go out / where is it / what's pending" |
| `results-capture` | record_result, list_awaiting_results, search_samples | Cupping verdicts + awaiting-feedback list |

**One scheduled job — `src/jobs/daily-chaser.job.ts`:** cron `0 6 * * 1-5`, timezone
`Africa/Nairobi`. Calls `POST /chaser/run`, formats the three buckets, and (if
`CHASER_USER_ID` is set) DMs the digest to that user.

**Wiring — `src/index.ts`:** registers persona + the 5 skills + the job on one
`LuaAgent`. *(Subtlety worth remembering: the persona must be assigned as an explicit
property `persona: persona` — the lua-cli compiler silently drops a shorthand `persona,`
and ships an empty persona.)*

---

## 8. The dashboard (`dashboard/`)

Vite + React 18 + react-router-dom. `src/api.ts` exposes `api<T>(path, init?)`, which
sends `x-actor: dashboard` — so dashboard edits also land in the timeline, attributed
correctly. Types live in `src/types.ts` (shared shapes: Sample, SampleEvent, Client,
Digest, …).

**Pages / routes**
- `/` — **Samples**: KPI tiles (`GET /stats`) + filterable, paginated table.
- `/samples/:id` — **Sample detail**: header, editable form (`PATCH`), courier tracking,
  and the full event timeline.
- `/clients` — **Clients**: search + view contacts + add client/contact.
- `/chaser` — **Chaser**: "Run now" (`POST /chaser/run`) → three buckets, PSS first.

**The chat widget — `src/widget.ts`:** loads LuaPop and calls
`window.LuaPop.init({ agentId, position, environment: 'production' })`.
`environment: 'production'` is **required on localhost** — it bypasses LuaPop's
domain-whitelist check so the widget connects to the deployed agent. (Alternatively /
additionally, add `http://localhost:5173` to the agent's Allowed-websites list in the Lua
dashboard.) `VITE_LUA_AGENT_ID`, `VITE_API_BASE`, `VITE_API_KEY` come from `dashboard/.env`.

---

## 9. End-to-end wiring (how a live demo is stood up)

Local stack: `docker compose up -d postgres` → `api` (`npm run dev`, :4000) → seed →
`dashboard` (`npm run dev`, :5173).

Connecting the **cloud agent** to the **local** API:
1. `cloudflared tunnel --url http://localhost:4000` → gives a public `https://…trycloudflare.com` URL.
2. `npx lua env production -k API_BASE_URL -v <tunnel-url>` and `-k API_KEY -v dev-key-sucafina`
   — the agent's tools now reach the local API through the tunnel. (Env is read at runtime;
   no redeploy.)
3. Whitelist `http://localhost:5173` (Allowed websites) and/or rely on the widget's
   `environment:'production'` so the browser widget can reach the cloud agent.

Deploy sequence used: `lua push all --force` → `lua deploy all --force` →
`lua version create` → `lua version promote`. **Never** bare `lua deploy` from
automation — promotion is deliberate.

> **Tunnel is ephemeral:** trycloudflare URLs change on every restart. When it moves,
> re-set `API_BASE_URL`. For an owned demo, run the tunnel in your own terminal.

---

## 10. Key conventions & decisions

- **API is the single writer.** Agent and dashboard both go through the API; neither
  writes SQL directly. This keeps the event/audit trail complete and the actor accurate.
- **Actor on every mutation** (`agent:chat`, `dashboard`, `job:chaser`, `api`) → an
  honest timeline.
- **`{ data, total }`** on all lists, `total` = true windowed count.
- **UUID validation up front** → clean 400s, never Postgres 500s.
- **Server-issued refs** via `ref_counters` (not client-generated), so refs never collide.
- **Tracking is simulated** — deterministic from the AWB hash; swappable for a real
  courier provider (the `TrackingProvider` interface exists for exactly that).

---

## 11. Prototype limitations (be honest in the demo)

- Courier tracking is **simulated**, not a live carrier API.
- No auth/SSO on the dashboard (single API key).
- The agent **logs and reports**; it doesn't price, allocate, or approve — it escalates
  those.
- 487 (not all 2,300) samples are joined to a `clients` row — see §6.
- The chaser job's proactive DM assumes a valid `CHASER_USER_ID`; without one, the digest
  is still computed, persisted, and shown on the dashboard.

---

## 12. How it was built (task history)

Built in 14 tasks via spec → plan → subagent-driven implementation, each task
test-and-review gated:

| # | Task | Result |
|---|---|---|
| 1 | Infra: docker-compose Postgres, Express+TS ESM, `/health` | ✅ |
| 2 | Schema + migrations (6 tables, 5 enums) | ✅ |
| 3 | Auth (`x-api-key`), errors, clients routes | ✅ |
| 4 | Samples routes: filters, ref issuance, PATCH + events | ✅ |
| 5 | `GET /stats` + deterministic `/tracking/:awb` | ✅ |
| 6 | Chaser digest: buckets, PSS-first, persistence, `chased` events | ✅ |
| 7 | Seed parsers (~60 tests) | ✅ |
| 8 | Seed runner — DB loaded (270 clients / 2,300 samples / 0 dropped) | ✅ |
| 9 | Agent: api client + intake/client-book skills + 3 tools | ✅ |
| 10 | Agent: dispatch / status-tracking / results skills + 7 tools | ✅ |
| 11 | Agent: persona + daily chaser job + final wiring | ✅ |
| 12 | Dashboard: scaffold + Samples page (tiles/filters/pagination) | ✅ |
| 13 | Dashboard: detail/edit + clients + chaser pages + widget | ✅ |
| 14 | End-to-end: tunnel + push/deploy + demo runbook (`DEMO.md`) | ✅ |

Two fixes surfaced during end-to-end bring-up (both from plan-supplied snippets):
- **Empty persona** — `src/index.ts` used shorthand `persona,`; the lua-cli compiler
  dropped it. Fixed to explicit `persona: persona` (verified 2,073-char persona in the
  compiled artifact).
- **Silent widget** — `src/widget.ts` didn't pass `environment: 'production'`, so LuaPop's
  localhost domain-whitelist blocked it. Fixed, plus `http://localhost:5173` whitelisted.

---

## 13. Running it

See **`DEMO.md`** for the boot order, the agent/tunnel wiring, the 5-minute demo script,
and troubleshooting. Reset demo data to pristine any time with `cd scripts && npm run seed`.
