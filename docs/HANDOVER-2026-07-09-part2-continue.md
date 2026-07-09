# Handover — continue A/B/C/D + reminder jobs (2026-07-09, part 2)

Paste this into a fresh chat to continue. Backend (A, B, reminders API) is **done and green**; the
agent side is **half done**. Remaining: the guided-intake skill, three reminder jobs, and final verify.

## Repo & ground rules
- Repo: `/Users/devashishthapliyal/Documents/work/Lua/Sucafina`. Parts: `src/` (Lua agent, compile
  `lua compile --ci` from repo root), `api/` (Express+Postgres, tests `cd api && npx vitest run` — needs
  `sucafina-postgres` docker on 5433, it's up), `dashboard-v2/` (React; `npm run typecheck && npm test`).
- **Nothing is committed; nothing is deployed.** Don't commit/deploy without an explicit ask.
- **Concurrent work moves the tree** — re-read files before editing; never commit others' uncommitted
  files. (Pre-existing uncommitted work from earlier sessions is in the tree: `search.ts` widening,
  enriched read tools, coverage tools `GetClientTool`/`GetSampleStatsTool`/`GetSamplesByBookTool`, etc.)
- **Bash hook gotcha:** commands containing `deploy`, `for`-loops, or that touch `.env` sometimes trip a
  PreToolUse hook. Run simple, single commands; use `/lua-deploy` for deploys.
- Approved plan: `~/.claude/plans/yep-cool-but-lets-distributed-pillow.md`.
  A+B design spec: `docs/superpowers/specs/2026-07-09-record-date-and-top-of-list-design.md`.

## Scope (what we're building)
- **A** new records default `date` (verbatim text) + `date_on` to **Nairobi today**, server-side, with an
  optional ISO `date` override. **B** newest-created row sorts to the top (`created_at DESC` tiebreak).
  **C** guided intake walks the full per-book field set (ask name/country/grade where they apply).
  **D** agent explains jargon (grade etc.) on request, then continues. **Reminders** = three nudge jobs
  (R1 courier+AWB, R2 chase feedback, R3 order-placed 15d after delivery), delivered via Lua Jobs,
  channel-agnostic (`User.get(env('CHASER_USER_ID')).send(...)`). Teams delivery is blocked platform-side
  (Azure Bot, Rares/Lawrence) → test via LuaPop web widget / `lua chat`, NOT Teams. Agent also **announces**
  the reminders on create (already implemented in persona).

## ✅ DONE (all uncommitted, working tree)

### Backend — verified: `cd api && npx vitest run` → **111 pass**; `npx tsc --noEmit` → clean
- **A** — `date`/`date_on` default in all three POST handlers via
  `COALESCE($N, to_char(now() AT TIME ZONE 'Africa/Nairobi','YYYY-MM-DD'))` and
  `COALESCE($N::date, (now() AT TIME ZONE 'Africa/Nairobi')::date)`; optional `date` in each `createSchema`.
  Files: `api/src/routes/{specialty,bulk,forwarding}-samples.ts`.
- **B** — `api/src/lib/list.ts` ORDER BY tiebreak now `... NULLS LAST, created_at DESC, id ASC`.
- **R.1** — `api/src/lib/reminders.ts` (new; UNION over 3 base tables incl. follow-up fields; 3 buckets),
  `api/src/routes/reminders.ts` (new; `GET /reminders/:kind` → courier-awb|feedback|order-placed, returns
  `{kind,count,items}`), mounted in `api/src/app.ts` at `/reminders`.
  - R1: `status IN ('requested','preparing') AND awb empty AND courier_norm empty AND created_at < now()-'1 day'`
  - R2: `status IN ('dispatched','delivered') AND feedback_received empty AND created_at < now()-'3 days' AND tab<>'forwarding'`
  - R3: `status IN ('delivered','results_in') AND delivery_on IS NOT NULL AND delivery_on < CURRENT_DATE-'15 days' AND order_placed empty AND tab<>'forwarding'`
  - **No migration needed** — `date`/`date_on`/follow-up columns already exist (migrations 002+004).
- Tests added/updated: `api/test/reminders.test.ts` (new), date-default + tiebreak tests in
  `{specialty,bulk,forwarding}-samples.test.ts`; `chaser.test.ts` now explicitly NULLs a `date_on`
  (create no longer leaves it NULL — the only test A broke); stale comments fixed in
  `clients-upgrades.test.ts` + `stats-filter.test.ts`.

### Agent — verified: `lua compile --ci` → clean, **23 primitives (5 skills, 17 tools, 1 job)**
- **Create tools (task done):** all three return `date` now. `CreateSpecialtySampleTool.ts` also gained a
  `country` input (normalized) + POSTs it + returns `name`/`country`. (Bulk already had `country`;
  forwarding uses origin/sender.)
- **persona.ts (task done):** (1) jargon rule changed to "explain briefly on request, then continue";
  (2) card template meta line now includes `<date>` and `<country if any>`, confirmation states the date
  ("Logged 2026-07-09"); (3) new rule: after logging a send-out sample, announce the follow-up nudges
  (book-aware — Specialty/Bulk get all three; Forwarding gets courier+AWB only).

## ⏳ TODO (do these next, in order)

### 1. Guided intake skill — `src/skills/sample-intake.skill.ts` (feature C + D glossary)
Expand GUIDED INTAKE + GUARANTEED COMPLETENESS to the **full per-book field set**, asking name/country/
grade **where the book has them**, and add a grade glossary block (persona already says "the sample-intake
skill carries a coffee-grade glossary you can quote"). Per-book checklists (date auto, ref auto for specialty):
- **Specialty:** name (estate/station), grade, country, outturn, bags, description/quality, sample_type,
  receiver, courier, qty, crop_year. (Tool now accepts `country`.)
- **Bulk:** sample_ref, quality (grade lives in this text), sample_type, client, country, client_ref,
  ico_mark, bags, moisture, water_activity, courier, qty, crop_year.
- **Forwarding:** sender, origin (its country), sample_ref, coffee_quality, receiver, id_number, courier, qty.
  (No grade/result; "name" role = sender + ID Number.)
Keep the required-field completeness list + the one-message fast path (don't wizard power users).
**Grade glossary to embed:** AA (largest, screen 17/18), AB (15/16), PB (peaberry, single round bean),
C (smaller than AB), E (elephant, largest/joined), TT (lighter/floaters from AA/AB sorting), MH/Mbuni
(natural/dried-cherry). (Team to verify wording.)

### 2. Three reminder jobs — `src/jobs/*.job.ts` + register (feature R.2)
Model on `src/jobs/daily-chaser.job.ts` (delivery pattern: `const u = await User.get(env('CHASER_USER_ID')); await u.send([{type:'text',text}])`; unset env → compute + return, send nothing). Optional shared
formatter `src/lib/reminder-format.ts` (item line like `• <ref ?? '(no ref)'> — <title> → <receiver>`).
Each job: `apiFetch('/reminders/<kind>')` → build text → send if recipient set → `return {success,count}`.
Reminder item fields available: `tab,id,ref,title,receiver,awb,courier_norm,status,created_at,delivery_on`.
- `courier-awb-reminder.job.ts` — cron `30 6 * * 1-5` (Africa/Nairobi) — endpoint `/reminders/courier-awb` — header "📦 Arrange courier + AWB (N)".
- `feedback-reminder.job.ts` — cron `35 6 * * 1-5` — `/reminders/feedback` — "💬 Chase client feedback (N)".
- `order-placed-reminder.job.ts` — cron `40 6 * * 1-5` — `/reminders/order-placed` — "🧾 Order placed after sample? (N)".
Register all three in `src/index.ts` (`import` + add to `jobs: [dailyChaserJob, …]`). LuaJob config shape:
`new LuaJob({ name, description, schedule:{type:'cron',expression,timezone}, execute })`.

### 3. Final verify (feature/task 8)
- `lua compile --ci` from repo root → expect **26 primitives (… 4 jobs)** after adding the 3 jobs.
- `cd api && npx vitest run` → 111 still green.
- `cd dashboard-v2 && npm run typecheck && npm test` → 50 green (no FE changes, but confirm).
- Optional agent smoke via `lua chat`/widget: guided intake asks name/country/grade; "what is grade?" →
  brief glossary then continues; a create shows a card with the date (+ name for specialty) and the agent
  announces the 3 reminders.

## Deploy (all gated on explicit user ask — DO NOT do unprompted)
1. **API** → redeploy to Contabo VPS (hand the user copy-paste rsync/ssh/docker commands per `DEPLOY.md`;
   don't SSH from the agent). Unlocks A, B, `/reminders`.
2. **Agent** → `/lua-deploy`; then `lua jobs deploy -i <job> -v latest` for each new job.
3. **Env** → set `CHASER_USER_ID` (operator's Lua userId) on the Lua platform so reminders deliver.
4. **FE** → none.
Post-deploy reminder smoke (web widget, NOT Teams): set `CHASER_USER_ID`, seed matching rows,
`lua jobs trigger -i courier-awb-reminder` (etc.), check `lua jobs history` / `lua logs --type job`.

## Notes / gotchas
- pg returns typed `date` as a JS Date → ISO string in JSON (TZ-fragile). Assert on the `date` **text**
  column, and verify `date_on` via a DB-side `::text` cast. Nairobi "today" in tests:
  `new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Nairobi'})`.
- Part A side effect: the existing `daily-chaser` (date_on-based) will now include API-created rows — expected.
- R3 depends on `delivery_on` being set (only on a PATCH `status→delivered`, specialty/bulk; forwarding has
  none). Agent has no "mark delivered" tool, so R3 fires only for rows marked delivered (e.g. via dashboard).
- Two nudge systems coexist (old `daily-chaser` + new `/reminders`) — intentional; consolidation is future.
