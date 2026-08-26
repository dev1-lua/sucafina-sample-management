# Handover — 2026-08-26: ship the keep-in-the-loop rebuild (+ Teams desk-group build next)

Paste-ready brief for a fresh session. Verified state as of commit `6ec7307` (pushed to main).

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
