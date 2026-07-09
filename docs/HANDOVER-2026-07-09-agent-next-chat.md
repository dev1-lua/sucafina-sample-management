# Handover — Sucafina Sample Agent (2026-07-09)

Paste this into a fresh chat to continue. It covers **everything done this session** and the
**new problems to tackle next**. Read the "Ground rules" first.

---

## 0. Ground rules & environment (READ FIRST)

- **Repo:** `/Users/devashishthapliyal/Documents/work/Lua/Sucafina`. Three parts:
  - `src/` — the Lua agent (persona, skills, tools, jobs). Compile with `lua compile --ci` from repo root.
  - `api/` — Express + Postgres backend. Tests: `cd api && npx vitest run` (needs the `sucafina-postgres`
    docker container on port 5433; it's up). Migrations in `api/migrations/`.
  - `dashboard-v2/` — React + Vite CRM. `npm run typecheck`, `npm test` (vitest), `npm run dev`.
- **Prod API:** `https://sucafina-api.luameet.in`. Base URL + `API_KEY` live in the repo `.env`
  (read them from the file inside a script — never inline the key on a command line; the auto-mode
  classifier blocks that, correctly).
- **Chat widget:** LuaPop (~22 MB UMD from a CDN) embedded in an **iframe on the `/assistant` route only**,
  via `srcDoc` (so it's **same-origin** with the app — no sandbox, no CSP). This is why the in-app click
  bridge works.
- **LuaPop rich-message directives** (docs.heylua.ai/formatting): `::: list-item` (presentation card,
  NOT clickable), `::: actions` (quick-reply buttons → send text back), `::: navigate`
  (`![navigate](/path)` — AUTO-fires, calls an `onNavigate` handler, strips itself), `::: links`,
  `::: images`. There is **no natively clickable card** — clickable navigation is done by our own relay
  (below), not by a directive.
- **Gotchas:**
  - A PreToolUse hook blocks any Bash command containing `lua deploy` — use `/lua-deploy` for deploys.
    Bare `lua compile`/`lua chat`/`lua push` are fine. Compound commands that touch the prod env/API
    sometimes trip it; run those as simple commands or via a node script.
  - **Active concurrent work** happens in this repo during sessions (backend `stats.ts`, migrations,
    `FilterBar`, `dashboard-filters`, sort indicators, chaser columns). The working tree and even `HEAD`
    move under you. **Do not commit others' uncommitted files.** Re-read a file before editing.
  - **FE deploy = commit to `main` + `git push origin main`** (Vercel auto-deploys). Do NOT use the Vercel CLI.
  - **Never commit or deploy without the user explicitly asking.**

---

## 1. What we did this session

### Part 1 — In-app jump (no external link) ✅ committed on `main`
Clicking a record link the agent renders in the chat now navigates **inside** the SPA (no new tab / reload),
**flashes + scrolls** the row, and opens its drawer — using the existing `?hl=` highlight machinery.
- `dashboard-v2/src/components/LuaChat.tsx` — capture-phase click relay inside the srcdoc iframe;
  intercepts anchors matching `^/(samples|bulk|forwarding|clients)/…?hl=…` and `postMessage`s the path up.
- `dashboard-v2/src/lib/useLuaChatBridge.ts` (+ `.test.tsx`, 3 tests) — parent listener → `navigate(path)`.
  Mounted in `App.tsx` (survives route changes; origin-checked).
- `dashboard-v2/src/components/RecordTable.tsx` — `rowVirtualizer.scrollToIndex` for the flashed row
  (was flashing invisibly off-screen). **NOTE:** only scrolls if the row is on the loaded page — ties
  directly into New Problem B below.

### Row-card presentation (follow-up ask) ⏳ uncommitted
Write results now render as a **row card + clickable open-link** instead of a bare URL. Purely a persona/skill
change; the relay above handles the click.
- `src/persona.ts` — write-result rule outputs `::: list-item` (fields laid out like the table row) +
  `[Open <ref> in <Book> →](<url>)`.
- `src/skills/dispatch-logging.skill.ts` — defers to that format.

### Part 2 — Guided sample intake ✅ committed on `main`
`src/skills/sample-intake.skill.ts` + `src/persona.ts`: explicit numbered steps, pick-lists
(book / sample type / grade), spoken defaults, echo + confirm, never write incomplete. Power-user one-shot
fast path preserved. **Incomplete — see New Problem C (doesn't yet ask name/country/grade or full per-book set).**

### Part 3 — Fetch completeness ✅ core committed / ⏳ widening uncommitted
QA proved the agent could not "fetch everything" (said "100 awaiting results" vs true **581**; couldn't list
past 25). Fixes:
- **Committed:** `api/src/routes/search.ts` pagination (`page`/`offset`); read tools `pageSize→100` + `page`
  + true `total` + `has_more`; `ListAwaitingResults` true count via `/stats`; `find_client` surfaces `total`.
- **Uncommitted (widening):** `/search` now also projects `country`/`sample_type_norm`/`qty_grams` and
  filters by `sample_type`/`country`; `SearchSamplesTool` surfaces them; `FindOpenSamples`/`ListAwaitingResults`
  stopped dropping courier/awb/date. api tests added.
- QA write-up: `docs/session-2026-07-08-fetch-qa.md`.

### Coverage expansion — the agent can now reach EVERY stored column ⏳ uncommitted
Traced Excel → DB → API → tools. Data is fully in the DB (seed drops nothing but 3 stray client cells);
the gap was tool reach. Added:
- `src/skills/tools/GetClientTool.ts` — client address/contacts/owner/order history (`/clients/:id`).
  Closes a real gap (client-book skill assumed address read-back but no tool could do it).
- `src/skills/tools/GetSampleStatsTool.ts` — counts/breakdowns via `/stats`.
- `src/skills/tools/GetSamplesByBookTool.ts` — FULL rows from one book (grade/outturn/moisture/ICO/sender/
  origin/id_number/comments/crop_year/sample_type/follow-up fields), with per-book filters.
- Wired into `client-book` / `status-and-tracking` skills; presentation guidance in persona + skills
  (compact cards, no raw JSON).

### Verification (this session, no deploy)
- agent `lua compile` → **24 primitives** (17 tools).
- `api` **102/102**; `dashboard-v2` **50/50** (+3 bridge tests).
- Live-prod tool-logic: fetch fixes 9/9; new tools 6/7 (7th = widened `/search` fields, awaits API redeploy).

### Git state (as of this handover)
- Branch **`main`**, HEAD `e84a507`. My work merged at `2d1e644`; concurrent work (chaser columns /
  migration 004, 3-state sort, dropdowns, widget light-theme, "New chat" control) is committed on top.
- **Committed:** Part 1, Part 2, Part 3 core (pagination + cap fixes).
- **Uncommitted (working tree):** the coverage tools (`GetClientTool`, `GetSampleStatsTool`,
  `GetSamplesByBookTool` — untracked), search widening (`search.ts` + `search.test.ts`), enriched tools
  (`SearchSamplesTool`, `FindOpenSamplesTool`, `ListAwaitingResultsTool`, `FindClientTool`), skill wiring
  (`client-book`, `status-and-tracking`, `dispatch-logging`), row-card `persona.ts`, and QA-doc updates.
- **Nothing from the uncommitted set has been deployed.**

### Deploy state / steps (all still pending, gated)
1. **FE** — `git push origin main` (Vercel). Unlocks the in-app jump (already committed).
2. **Agent** — `/lua-deploy`. Unlocks guided intake, fixed fetch tools, coverage tools, row cards.
   (Coverage/row-card changes must be committed first.)
3. **API** — redeploy to the Contabo VPS (Docker/Caddy per `DEPLOY.md`). Unlocks `/search` pagination
   (committed) + widened fields/filters (uncommitted).

---

## 2. NEW problems to tackle (this is the next-chat worklist)

### Problem A — The agent doesn't set / know the date; new records have no date
**Symptom:** created records have a blank Date; the agent can't state "today's date" on its own.
**Root cause (diagnosed):** the create endpoints' `createSchema` does NOT accept a `date`, and the INSERTs
never set `date`/`date_on` (see `api/src/routes/specialty-samples.ts` INSERT ~L95-105; bulk L98-108;
forwarding L83-90) → `date_on` is NULL. The agent persona also has no "today" awareness.
**Fix (recommended):** default `date`/`date_on` to `CURRENT_DATE` in the three create handlers (server-side,
so it's robust and needs no date-knowledge from the model); optionally accept an explicit `date` override.
Then have the create tools echo the returned `date_on` and the agent state it in its confirmation ("Logged
today, 2026-07-09"). Alternatively/also inject the current date into the agent context.
**Files:** `api/src/routes/{specialty,bulk,forwarding}-samples.ts` (schema + INSERT), `src/skills/tools/
Create*Tool.ts` (echo `date`), `src/persona.ts` (confirmation states the date). **Backend → needs API redeploy.**

### Problem B — The latest record I create should appear at the TOP of the list
**Symptom:** newly logged samples "get lost"; the user has to search for them.
**Root cause (diagnosed):** the list sorts by `date_on DESC NULLS LAST` (`api/src/lib/list.ts` defaultSort
`date_on`); with Problem A leaving `date_on` NULL, new rows sink to the **bottom / last page**. Compounding:
the Part-1 scroll-into-view only fires if the row is on the currently-loaded page — a bottom row on the last
page is never on page 1, so the deep-link flash/scroll silently no-ops (drawer opens but the row isn't visible
in the list).
**Fix:** primarily solved by Problem A (date_on = today → floats to top under `date_on DESC`). Consider also
defaulting the list sort to `created_at DESC` for a true "most-recently-created first," or a "recently added"
affordance. Confirm the FE refetches after an agent write (React Query — it does on focus/navigation).
**Files:** ties to Problem A; optionally `api` per-table `defaultSort` or `dashboard-v2` default sort +
`RecordTable.tsx`.

### Problem C — Guided intake must ASK name, country & grade — and ALL fields for whichever tab
**Symptom (see attached screenshot):** created rows show NAME, COUNTRY, GRADE as "—" — the agent never asked.
**Root cause (diagnosed):** the guided intake only collects each book's hard-required minimum
(specialty: description + sample_type + receiver; bulk: quality + sample_type + client; forwarding: sender +
origin + sample_ref + coffee_quality + receiver + id_number). Fields like **name, grade, country**, outturn,
bags, ico_mark, moisture, etc. are optional and never prompted. The create-tool schemas ALREADY accept them
(`specialty` create takes name/grade/outturn/bags/country; `bulk` takes country/ico_mark/moisture/…), so this
is mostly **prompt-level**.
**Fix:** expand the GUIDED INTAKE block in `src/skills/sample-intake.skill.ts` to walk the **full per-book
field set**, always asking **name, country, grade** (per the user, these are non-negotiable), and explaining
grade when asked. Per-book checklists:
- **Specialty:** date (auto), ref (auto), **name** (estate/station), **grade**, outturn, bags, description/
  quality, sample_type, receiver, courier, qty, crop_year, **country**.
- **Bulk:** date (auto), sample_ref, quality, sample_type, client, **country**, client_ref, ico_mark, bags,
  moisture, water_activity, courier, qty, crop_year.
- **Forwarding:** date (auto), sender, origin (its "country"), sample_ref, coffee_quality, receiver,
  id_number, courier, qty. (Forwarding has no grade/result.)
**Grade explainer (agent should give if asked "what is grade?"):** Kenyan coffee screen grades by bean size —
**AA** (largest, screen 17/18), **AB** (15/16), **PB** (peaberry, single round bean), **C** (smaller than AB),
**E** (elephant, largest/joined), **TT** (lighter/floaters from AA/AB sorting); **MH/Mbuni** = natural/dried-
cherry. (Verify wording with the team.)
**Files:** `src/skills/sample-intake.skill.ts`, `src/persona.ts`; verify `CreateBulkSampleTool` /
`CreateForwardingSampleTool` / `CreateSpecialtySampleTool` pass country/name/grade through (specialty already
does).

### Problem D — Explain jargon (grade etc.) on request
Part of Problem C — the agent should define grade (and similar terms) when asked, then continue the flow.

---

## 3. Carry-over open items (from earlier this session)

- **Clickable rows in SEARCH results too** (offered, not done): make any row the agent lists clickable to jump
  to it — same card pattern, needs read tools to also return the row `url` (via `dashboardUrl`).
- **Beyers not in the client book** — `find_client("beyers")` → 0, though 23 samples reference it. Data gap,
  not code; team should add the client.
- **`SL-7346` has 2 records** — `get_sample_status` resolves only the first match (`pageSize=1`); add
  disambiguation if desired.

---

## 4. QA / verification prompts (once deployed)

**In-app jump / row card (#1)** — writes to prod data; use `ZZTEST-` markers and delete after:
- "Log a specialty sample: AA Swara, offer, to Sucafina NV — ZZTEST-1" → expect a **row card** in chat +
  "Open … →"; click → in-app jump to the Sample tab, row flashed + scrolled, drawer open (no new tab).

**Fetch (#3)** — read-only. Ground truth (drifts): dispatched **1669**, delivered **581**, awaiting_results
**581**, requested **8**, "sucafina nv" **185**, SL-7346 **2**, clients "beyers" **0**.
- "How many awaiting results?" → **581** (pre-fix bug said 100).
- "List all samples to Sucafina NV" → states **185**, shows a page, offers to narrow/continue (never "the full list").
- "What's Beyers's address?" → uses `get_client`; if 0 contacts, says so + offers to add.
- "Break down samples by country" → `get_sample_stats`.
- "Show the grade and moisture for the bulk samples to X" → `get_samples_by_book` (full rows).

**Commands:** `lua compile --ci` (repo root); `cd api && npx vitest run`; `cd dashboard-v2 && npm run typecheck && npm test`.
Ground-truth/tool-logic scripts from this session can be recreated by reading `.env` in a node script and
hitting `/stats`, `/search`, `/clients` directly.
