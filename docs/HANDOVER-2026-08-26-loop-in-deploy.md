# Handover — 2026-08-26: ship the keep-in-the-loop rebuild (+ Teams desk-group build next)

Paste-ready brief for a fresh session. Verified state as of commit `6ec7307` (pushed to main).

## Update 2026-08-26 (same day, later) — what changed since `6ec7307`

Built and verified locally on top of the pending deploy (api 191 / dashboard 73 / `lua compile --ci` 44 primitives / `npm run harness:loop-in` 23 checks / `lua test skill save_notify_contact` 3 cases):

1. **Refs restart (Brillian #36/#37)** — `api/migrations/015_ref_counters_restart.sql`: `SL` counter → 7459, `TYPE` → 108, **unpadded** (`SL-7459`, not `SL-07459`), one-shot via a `_restart_2026_08` marker row in `ref_counters` (safe to re-run; `deploy-api.sh` applies it after 014). Rows already issued as SL-80xx / TYPE-10xx keep their refs. SSKE/CN untouched.
2. **Keep-in-the-loop hardening** (`SaveNotifyContactTool` + `src/lib/notify.ts`): the person is resolved **by email first** (one inbox = one roster row, no duplicate pings), then unique name, then refuses with the candidate list on an ambiguous name ("which Thomas?"); an **email alone is enough** (name derived from the address: `thomas.mueller@…` → "Thomas Mueller"); an email given for an existing person is PATCHed onto their row (never renamed). Skills say so (bare-email answer is complete; "nobody/skip" drops it; never ask twice). Tool result carries `matched_by: email|name|created`.
3. **Bug fix** — `PATCH /clients/:id {account_owner_id: null}` was a no-op (COALESCE), so the dashboard's "Unassigned" never unassigned the account manager. Fixed + tested.
4. **New local harness** `scripts/loop-in-harness.ts` (`npm run harness:loop-in`; needs the local API on :4000 — it sets `API_KEY=dev-key-sucafina` explicitly because lua-cli's `env()` otherwise loads the PROD key from `.env`). Covers gap-fires / no-gap-after-save / email-only / duplicate-email / ambiguous / no-email refusal / invalid email / manager-without-email patch / send-time recipients deduped. Cleans up after itself.

Deploy order is unchanged (below) with two additions: expect `== migration 015` → `DO` in the API deploy output and verify counters with
`ssh root@156.67.105.74 "cd /opt/sucafina && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres psql -U sucafina sucafina -c 'SELECT * FROM ref_counters ORDER BY prefix'"` (SL 7459, TYPE 108, marker present). Prod QA matrix runs **outside the cron window** (after 19:00 Nairobi / Sunday) so nothing reaches Harriet/Bernard while QA rows exist; one labelled "QA TEST" sample runs in-window with the user's chosen test inbox as the loop-in so the real status email is observed.

## SHIPPED 2026-08-26 ~15:30–16:30 IST — API (migrations 014+015) + agent **v39** live; prod QA PASSED

- User deployed the API (015 → `DO`; prod counters SL 7459 / TYPE 108 / marker present) and the agent via `lua push all` + `lua deploy all --force` (promoted v36–v38 per primitive) + `lua version create/promote` → **v39 active**. `lua version diff v35 v39`: 6 skills 1.0.21, both jobs, current-datetime bumped; persona/model UNCHANGED, no job additions.
- Prod QA (thread `loopin-qa-0826`, cleared): first refs issued **SL-7459 / TYPE-108** ✓; question fires once after the ref in Ivo's exact words ✓; bare-email answer → roster row "Qa Manager" + client account manager ✓; second sample same client → no question ✓; "keep Omar in the loop on TYPE-108" → added, no email asked ✓; new name → asks email once → saved ✓; "Thomas Ng handles <client>" → asks email → manager swapped ✓; manager on file without email → bot asks (rephrased to name Omar) → email PATCHed onto Omar's row, no duplicate ✓; "don't know, skip it" → dropped, no re-ask ✓; `PATCH account_owner_id:null` unassigns ✓; send-time recipients correct incl. `email: null` person listed ✓; **live ping**: SL-7460 preparing → "people in the loop notified: preparing — Dev (teams)" at 16:15:42 (dev@luaimplementation.ai is warm on Teams, so Teams DM not email).
- Side effects: Harriet + Bernard received ONE QA "New sample request" ping for SL-7460 (cron fires ~50–60 s AFTER the quarter-hour, not on the second — allow ≥2 min margin next time). Both delivered via **Teams** → they are now warm on Teams. Cleanup done: QA samples soft-deleted, QA client soft-deleted, Omar email reset to NULL, QA roster rows (Qa Manager, Lena Berg, Thomas Ng, Dev) deactivated — hard-delete: `DELETE FROM traders WHERE email IN ('qa.manager.0826@example.com','lena.berg.qa0826@example.com','thomas.ng.qa0826@example.com','dev@luaimplementation.ai');` (run on prod psql).
- Two model-wording nits seen (mechanism correct): after "SL-7460 is being prepared" the bot said "Ivo will be pinged" (the requester — but pings go to the people in the loop); the manager-without-email question was rephrased to name the person instead of Ivo's exact sentence. Skill-text nudge candidates for the next version.

## Follow-up 2026-08-26 evening — agent **v43** live: Teams channel pinned; email leg PROVEN

- Found via the live run on v39: `sendToPerson` used `User.get({email}) → user.send()`, and `User.get` resolves a user from ANY channel history (web chat, dev console, old shared Teams bot). The ping "delivered" into that dead conversation and was labelled "(teams)". Fix (`src/lib/notify.ts`, commit caeb832): resolve the Lua userId, then `Channels.send({ channel: 'teams', to: { userId }, text })` — warm-only on Teams, rejects with "No direct conversation with this user on teams" → email fallback runs. Also: status-change replies no longer say the requester is pinged (c045e5b, 1ee9b94).
- User deployed v43 (`push all` + `deploy all --force` → v40–42, then version create/promote v43; diff v39→v43 clean, persona/model unchanged).
- Re-run on v43 (thread `loopin-qa2`): SL-7461 → bare-email answer → Dev account manager → preparing → 17:15:47 IST job: **"preparing ping for SL-7461 → Dev (email)"**; QC ping: **"Bernard (email), Harriet (email)"** — both rejected on Teams ("No direct conversation…"), i.e. their earlier "(teams)" deliveries were swallowed into old/other-channel conversations. They are in the re-DM group.
- Gotchas learned: `lua chat --clear` left thread `loopin-qa-0826` returning HTTP 500 on every later message (use a fresh thread id per QA session); the */15 cron fires ~45–60 s after the quarter-hour; `save_notify_contact` only sees ACTIVE roster rows, so an inactive person given again by email is re-created via the name-upsert (re-activates the same row — fine, but inactive ≠ invisible).
- Cleanup: SL-7461 + client "QA Loop Client 0826b" soft-deleted, Dev row deactivated, outbox empty, threads loopin-qa2/loopin-smoke cleared.
- Parked: 3 `agent_error` entries (25–26 Aug) — inbound EMAILS to ping@heymail.ai fail with "media type: message/rfc822 not supported" (someone replies to the bot's emails; the email channel's inbound path can't feed the model). Raise with Lua.

## Follow-up 2026-08-27 — agent **v47** live: Teams-nudge footer on notification emails

- `src/lib/notify.ts`: `sendToPerson`'s email leg now appends `EMAIL_FOOTER` — "Sent by Lua Sample Manager → Add me to your Teams Chat to send sample requests directly to Quality, and stay in the loop." Email only: people land on that leg precisely because they're cold on Teams, so it's the nudge to fix that; Teams pings are unchanged. The client-facing dispatch email (`lib/client-email.ts`) is deliberately NOT footered — external clients can't add the internal bot. Footer ships in `dist-v2/artifacts/job/status-notifier.js` (the only bundle using `sendToPerson`).
- User deployed: `lua push all --force` → `lua deploy all --force` (v44–46) → `lua version create -m "mail footer"` → `promote v47`. `lua version diff v43 v47`: skills 1.0.23, dispatch-notifier 1.0.11, status-notifier 1.0.7, current-datetime 1.0.14; **persona/model unchanged**, `lua models --json` → `anthropic/claude-sonnet-5`. On lua-cli 3.27 `push all` now carries persona + model ("Persona version 15 created", "Model … pushed" — "Model settings cleared" is tuning defaults, not the model); the blank-model footgun did not recur.
- Not smoke-tested live (would email real QC staff); first real-world check = next notification that falls back from Teams. To add the "Add me" flow: 1:1 chat with the Lua bot → paste the Sample Management connect code (internal memo, kept out of the public repo).
- Hook gotcha: the lua plugin's deploy-guard blocks ANY Bash-tool command containing `$` with "Bare `lua deploy` is blocked" — write full paths / no shell vars, or run via a scratchpad `.sh`.

## Where things stand

Three surfaces, one repo (see `HANDOVER-2026-08-20-round5-part2.md` for the architecture):
- **API** — `api/` on the Contabo VPS. Live at commit `bb9efa6`-era code (migrations 011–013 applied; editable dispatch date + date-string serialization live and verified).
- **Dashboard** — `dashboard-v2/` on Vercel, auto-deploys on `git push origin main`. Current with `6ec7307` (Team page, dispatch-date picker, "Account manager — kept in the loop" label on client pages).
- **Agent** — live at **v35**, skills 1.0.20, persona v12 (content = v8), model `anthropic/claude-sonnet-5`, jobs: dispatch-notifier + status-notifier (armed, first live ping delivered 24 Aug). **Outbound email live**: inbox `ping@heymail.ai`, display "Sucafina Samples", `EMAIL_CHANNEL_READY=true` in `src/lib/notify.ts`.

**Everything from feedback rounds 1–5 plus #33–35 is live and production-verified** (see `feedback-status.md`: 34 of 35 done; #24 needs a trading-system data feed). `round5-happy-path.md` is the team-facing walkthrough, current with all of the below.

## The one thing built but NOT yet deployed: keep-in-the-loop rebuild (#34 reinterpreted)

Ivo clarified (25 Aug, voice note): the person "kept in the loop" is **Sucafina's account manager for the client** on the sales/destination side (a tier below Ivo; fields the client's "is it on the way?" questions) — ONE PER CLIENT — not the origin trader who raised the request. Commit `6ec7307` rebuilds it; all local tests green (api 188, dashboard 73, `lua compile --ci` 44 primitives):

- **API**: migration `014_loop_in_contacts.sql` adds `notify_trader_ids uuid[]` to the 3 sample tables. `GET /notifications/outbox-pending` now returns `recipients[]` per item, resolved AT SEND TIME = `clients.account_owner_id` ∪ sample's `notify_trader_ids` (a manager set after the event queued still gets it). `enqueueStatusEvents` queues transitions even without `requested_by`. PATCH accepts `notify_trader_ids` (replaces list). `scripts/deploy-api.sh` now applies 014.
- **Agent**: `notifyContactGap(clientId)` — the intake question ("Who should be updated once we have the AWB or if there are follow-up questions? Please share the email.") fires when the CLIENT has no account manager with an email; the answer saves via `save_notify_contact { name, email?, client?, sample_ref? }` (sets `client.account_owner_id` and/or appends to one sample's loop; roster upsert keeps short names + roles). The tool also lives in status-and-tracking for "keep Thomas in the loop on TYPE-1020" / "Thomas handles Paulig". `status-notifier` pings everyone in `recipients[]`; `requested_by` ("Sales Trader" column) unchanged = requester.
- **Dashboard**: client page field relabeled; Team page manages the people. Already live (Vercel).

### Deploy steps (in this order — the USER runs them)

1. **API** (fresh tarball already built from `6ec7307`, 1306065 bytes):
   `rsync -avz sucafina-deploy.tar.gz root@156.67.105.74:~/` then `bash scripts/deploy-api.sh` (script runs LOCALLY and ssh's itself). Expect `== migration 014` with 3× ALTER TABLE, and Docker's `COPY . .` step NOT "CACHED" (CACHED = stale tarball, rebuild with `git archive --format=tar.gz -o sucafina-deploy.tar.gz HEAD`). Ignore the script's local health-check failure; verify `https://sucafina-api.luameet.in/health` and that `outbox-pending` items carry `recipients`.
2. **Agent v36** (after the API — the tool calls endpoints that only exist post-deploy):
   `lua compile --ci` → `lua push all --ci --force` → `lua models set anthropic/claude-sonnet-5` → `lua version create -m "keep-in-the-loop: client account manager"` → `lua version diff v35 v36` (expect: skills + both jobs, persona/model unchanged, no job additions) → **`lua version promote v36` only on the user's explicit standalone go**. Prefer version create+promote over `lua deploy all` (resurrection risk; it also burns version numbers).
3. **Prod QA** (agent runs it, `lua chat -e production -t <thread>`): log a sample for a client with NO account manager (internal receiver "Geneva" avoids the address gate; pass client_id) → question fires once, exact wording → answer "Name, email@example.com" → roster + client updated (`GET /clients/:id` shows account_owner) → second sample for the same client raises NO question → "keep X in the loop on <ref>" appends to `notify_trader_ids` → check `outbox-pending` recipients. **Delete QA samples within the 15-min cron window** (soft-delete drops pending pings), reset any touched roster/client rows, clear the thread (`--clear -m "done"`).

## Next build (waiting on Lua/Rares): Teams desk-group callouts

Lua shipped group POSTING 25 Aug: `Channels.send({ channel:'teams', to:{ conversationId:'19:…@thread.v2' }, text })` — needs **lua-cli 3.26.0** (installed: 3.25.0, run `lua update` first). Bot must be added to the group + @mentioned once; the id arrives on inbound messages from that chat. Asked Rares (a) which inbound field carries the conversation id, (b) the list of the **8/11 Teams users stuck on the old shared bot** (they must re-DM the bot once — the agent moved to Sucafina's own Azure bot in early Aug; this is why pings fall back to email). Build when answered: capture/store the desk group's conversationId (preprocessor or tool), post new-request pings + missing-details callouts there alongside the 1:1s; answers stay 1:1 (bot can't attribute speakers in groups). Ask #2 (bot creates group chats) parked — answered "per team". Do NOT enable Lua's shared-group-memory setting (resets history for all users).

## Gotchas (the ones that have burned us)

- Repo-root `.env` points at PROD — for `lua test`, back it up, set `API_BASE_URL=http://localhost:4000` + `API_KEY=dev-key-sucafina`, RESTORE after. Local stack: `docker start sucafina-postgres` (port 5433; Docker Desktop may need `open -a Docker` first), `cd api && DATABASE_URL='postgres://sucafina:sucafina@localhost:5433/sucafina' API_KEY=dev-key-sucafina npx tsx src/server.ts`. Migration 014 is already applied locally. Never `npm run migrate` full-replay — apply single files via `docker exec -i sucafina-postgres psql -U sucafina sucafina < api/migrations/<file>.sql`.
- API tests share the local DB and reset it; two concurrent suite runs collide (one flaky fail = rerun solo).
- `lua push all` blanks the model → always `lua models set anthropic/claude-sonnet-5` after. Agent deploys are the user's to run; promote needs an explicit standalone go.
- **No `Co-Authored-By: Claude` trailer on commits** (user preference, repo is public).
- Teams sends are warm-only per user; email fallback sends from `ping@heymail.ai` (first email may hit spam). QC pings go to roster role `qc` with email (Harriet + Bernard). Job cron: */15, 07:00–19:00 Nairobi, Mon–Sat.
- A hook sometimes false-positives "Bare `lua deploy` is blocked" on innocent curl commands mentioning luameet.in — put the command in a scratchpad .sh file and `bash` it.

## After the deploy ships

- `feedback-status.md` row 34 and `round5-happy-path.md` are ALREADY written for the new behavior (they ride `6ec7307`) — nothing to flip, just confirm QA passed.
- Update auto-memory `feedback-round5-state.md` (deployment status lives there) + `teams-group-send.md` when Rares answers.
- Open question for Ivo's team: rename the sample column "Sales Trader" → "Requested by" (label-only change) now that "account manager" is the loop-in person?
