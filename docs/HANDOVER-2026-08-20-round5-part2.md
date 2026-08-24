# Handover — Round-5 part 2: notify-contact capture + arm status-notifier (version N+1)

Paste-ready brief for a fresh session. Everything below is verified state as of 2026-08-20 (commit `34042dc`).

## Where things stand (all deployed & production-tested)

Three surfaces, one repo:
- **API** — `api/` (Express + pg, raw SQL) on the Contabo VPS. Deploy: commit → `git archive --format=tar.gz -o sucafina-deploy.tar.gz HEAD` → `rsync` to `root@156.67.105.74:~/` → `bash scripts/deploy-api.sh`. Migration `013_logged_by_and_outbox.sql` is live on prod. NOTE: the script's `curl localhost:4000/health` always fails (no published ports; Caddy proxies on the `lua-edge` network) — verify via `https://sucafina-api.luameet.in/health` instead.
- **Dashboard** — `dashboard-v2/` (Vite/React), deploys by `git push origin main` (Vercel; never the Vercel CLI). Password-gated (edge middleware; never enter the password yourself — the user unlocks).
- **Agent** — `src/` (lua-cli). Live: agent **v26**, skills 1.0.16, persona v8, model `anthropic/claude-sonnet-5`, exactly ONE job registered (`dispatch-notifier`). The four legacy jobs (daily-chaser, courier-awb-reminder, feedback-reminder, order-placed-reminder) were **deleted from the server** — do not recreate them; prefer `lua version create` + `lua version promote` over `lua deploy all` (deploy-all resurrects server-only leftovers).

**Round-5 features live in prod (feedback #28–32):** `logged_by` (auto-stamped from the chatting Teams user) + `requested_by` relabeled "Sales Trader" on all three books; `notifications_outbox` queue filled in-transaction on create/PATCH (`created`→qc, `preparing`/`dispatched`/`awb_added`→the row's sales trader, deduped by UNIQUE(tab,sample_id,event), awb_added suppressed when the AWB rides the dispatch call); `notify_trader_missing_details` tool (warm 1:1 Teams DM, NO email fallback, honest `delivered:false`); `set_sample_status` tool (QC "preparing"); Wells Fargo courier everywhere. Production QA passed end-to-end on 2026-08-20 (thread `round5-qa`): test row TYPE-1016 exercised every flow.

**The delivery job `status-notifier` exists but is NOT armed**: `src/jobs/status-notifier.job.ts` is complete and sandbox-tested; its import + registration in `src/index.ts` are commented out (marked with a 2026-08-20 comment block) per the one-job-per-version protocol (see the v1.0.5 incident note at the top of index.ts). v26 soaked healthy — arming it is part of this handover.

**Roster state (prod `GET /traders`):** Harriet `harriet.muthoni@sucafina.com` and Bernard `bernard.chege@sucafina.com` (both role `qc` — the Kenya Quality contacts per Ivo Jr.; the job pings only QC members WITH an email, so this already implements his per-country instruction for Kenya). All five traders (Ivo/Omar/Muki/Brian/Gloria) have NO email → trader status pings mark `skipped` until captured (that's Task 1's job). Anička/Brillian: role `qc`, no email, intentionally silent.

## Task 1 — BUILD: notify-contact capture at intake (feedback #34, Ivo Jr.)

Ivo's ask, verbatim: *"The 'Sales Trader' who is to be kept in the loop — the best way to capture this is asking the person straight away 'Who should be updated once we have the AWB or if there are follow up questions? Please share the emails'."*

Design (agreed with the user):
1. New agent tool (e.g. `src/skills/tools/SaveNotifyContactTool.ts`, name `save_notify_contact`): input `{name, email, role?}` → `POST /traders` via `apiFetch` (upsert on name — **short first names are the roster keys**: "Muki", not "Muki Kristiya Bongers"; match with `matchTrader` from `src/lib/notify.ts` first and reuse the existing row's name so no duplicate row is created). Default role `trader`. Return the saved row.
2. `src/skills/sample-intake.skill.ts`: extend the PEOPLE ON THE RECORD block — after the sample row is confirmed/created, if the Sales Trader on the record has no email on file (`GET /traders` + `matchTrader`), ask ONCE, using Ivo's wording: "Who should be updated once we have the AWB or if there are follow-up questions? Please share the email." Save via `save_notify_contact`. Skip entirely when the email is already on file. If they share several emails, save each as its own contact, but note only the named Sales Trader (`requested_by`) receives the automatic status pings today — put extras on the record via comments or flag as future work. Never block the sample on this; never claim a ping was sent.
3. Keep the skill's NO NARRATION voice; error strings are model-facing instructions (see `src/lib/client-guard.ts:94-106` for the house style).

## Task 2 — ARM `status-notifier` (agent version N+1)

Flip the two commented lines in `src/index.ts` (import + `jobs: [dispatchNotifierJob, statusNotifierJob]`). That's the entire code change. The job: polls `GET /notifications/outbox-pending` (cron `*/15 7-19 * * 1-6` Africa/Nairobi), sends per person (warm Teams DM via `User.get({email})` → `user.send`, else `Channels.email.send` — both in `src/lib/notify.ts` `sendToPerson`), then `POST /notifications/outbox-mark {id, via: teams|email|skipped, detail}` with `x-actor: job:status-notifier`. Marks AFTER successful send; `skipped` rows age out at 5 attempts. Verified in sandbox: 8 pending → 1 sent + 7 skipped, idempotent re-run.

## Task 3 — Cleanup (before or with the deploy)

- Soft-delete prod test row **TYPE-1016** (`DELETE /specialty-samples/abd4487e-a001-4001-bf2c-460a7cfeca23` with `x-api-key`) — this also drops its 3 pending outbox rows from the queue (the pending query joins `deleted_at IS NULL`). Do this BEFORE the job goes live or QC gets pinged about a test sample.
- Clear the QA chat thread: `lua chat -e production -t round5-qa --clear -m "done"`.

## Testing & deploy protocol (gotchas that have burned us)

- **`.env` at repo root points at PROD** (`API_BASE_URL=https://sucafina-api.luameet.in`). For `lua test`, back it up and temporarily set `API_BASE_URL=http://localhost:4000` + `API_KEY=dev-key-sucafina`, restore after. Local API: docker container `sucafina-postgres` (port 5433, db `sucafina`), then `cd api && DATABASE_URL='postgres://sucafina:sucafina@localhost:5433/sucafina' API_KEY=dev-key-sucafina npx tsx src/server.ts`. `npm run migrate` full-replay FAILS on an existing DB (001's CREATE TYPE unguarded) — apply individual migration files via `docker exec -i sucafina-postgres psql -U sucafina sucafina < api/migrations/<file>.sql`.
- Test suites: `cd api && npm test` (182 green), `cd dashboard-v2 && npm test` (66 green) + `npx tsc --noEmit`, `lua compile --ci`, tools via `lua test skill --name <tool> --input '<json>' --json`, job via `lua test job --name status-notifier --json` (register it first). Clean any local-DB test rows after.
- **Agent deploy is the USER's to run** (hand over commands; NEVER promote without an explicit standalone go): `lua compile --ci` → `lua push all --ci --force` (⚠️ blanks the model) → `lua models set anthropic/claude-sonnet-5` → `lua persona sandbox` → "Create version" → `lua persona production deploy` (only if persona changed) → `lua version create -m "..."` → `lua version diff v26 <new>` → sandbox/prod QA → `lua version promote <new>`.
- Production conversational QA: `lua chat -e production -t <thread> -m "..."` (thread id gives multi-turn continuity).
- Teams is **warm-only** (recipient must have DM'd the bot once) and the platform has NO group-chat send target (`ChannelSendTarget` = userId|phoneNumber|email only) — never promise group chats.

## After it ships

- Update `docs/feedback-status.md`: add rows 33 (WHO TO EMAIL — done: Harriet + Bernard wired) and 34 (contact capture), flip 29/30 to live, refresh summary + date. Commit + push (docs ride the same repo).
- Update the auto-memory file `feedback-round5-state.md` (deployment status lives there).
- Remind the team: everyone should DM the bot once so pings arrive in Teams instead of email.
- Parked/future: per-country Quality contacts table (when a non-Kenya desk onboards); multiple notify-contacts per sample; `clientFeedbackChaserJob` is the next job in line after this one soaks; Bavo's item 24 needs a sales-data feed; group-chat feature ask stays open with Lua.
