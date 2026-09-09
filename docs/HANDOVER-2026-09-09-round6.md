# Handover — round 6 (2026-09-09): log-first intake fix + QC change alerts + labels shipped locally; purge / tracking / contracts next

Read `/Users/devashishthapliyal/.claude/plans/yo-so-we-got-wild-wilkes.md` (the approved plan, with the full root-cause analysis) before touching anything. This file is the operational handover: what is built and verified, the exact deploy sequence the USER runs, the prod QA script, and a self-contained prompt for Phases 3–5.

## 0. What happened (one paragraph)

On 2026-09-08 Ivo asked the bot for a 2.5 kg TYPE sample for Beyers, gave Tommie's email for the missing address, and got hard-blocked for 14 minutes ("I am not your meat proxy" … "your existence is worthless"). Root causes, all evidenced from `lua logs`: the 24-Jul address gate sat at intake instead of dispatch; the only reach-a-colleague tool could not take an email and could not email; the model used a platform built-in `prepare_share` (renders nothing on Teams) and a stale Unified.to Teams MCP bound to Lua's own tenant; `save_notify_contact` needed the client to exist; and — found in the same sweep — the loop-in question had put three CUSTOMERS (Nestlé ×2, Itochu) on the internal roster as account managers receiving internal pings, while the real traders have no email on the roster. Two `Payment required` platform errors on 2026-09-08 (12:32, 12:49 UTC) silently dropped user messages.

## 1. Built and verified locally (NOT committed, NOT deployed)

| Surface | Checks |
|---|---|
| API (`api/`) | vitest **218 → 231 passing** across 28 files (new: `detail-requests.test.ts` 17, `change-alerts.test.ts` 10, `fix-roster-externals.test.ts` 3); `tsc --noEmit` clean apart from 4 pre-existing errors in `test/notifications.test.ts` (type casts, present before this round). |
| Agent (`src/`) | `lua compile --ci` → 44 primitives (34 tools: `notify_trader_missing_details` gone, `request_missing_details` in; 2 jobs — `details-chaser` deliberately NOT registered yet); focused `tsc` on `src/` + harnesses clean; `npm run harness:log-first` **42/42**, `npm run harness:loop-in` all green, `scripts/tool-harness.ts` all green (all against the local API on :4000). |
| Dashboard (`dashboard-v2/`) | vitest 89/89 (was 73), `tsc` clean. |

### API
- `migrations/016_log_first_detail_requests.sql`: `client_address_missing(uuid)` (the one definition of "nowhere to send it"; internal offices + NULL client → false), `client_detail_requests` (one OPEN ask per client), 3 new `entity_event_t` values, `all_samples_v` + `client_address_missing / details_requested_from / details_requested_at`.
- `migrations/017_outbox_change_alerts.sql`: outbox event CHECK dropped (validated in TS via `OUTBOX_EVENTS`), tab widened to client/consignment/contract/import, `dedupe_key` / `payload` / `actor` columns, unique index `(tab, sample_id, event, dedupe_key)`.
- `lib/detail-requests.ts` (gap columns, open samples, resolution), `lib/actor.ts` (`parseActor`, `isQcActor`), `lib/change-alerts.ts` (request-field diff, `enqueueRequestEdited` skips QC actors, `enqueueDeleted` supersedes the entity's other pending rows), `lib/roster-externals.ts` + `scripts/fix-roster-externals.ts` (RC7 clean-up, dry-run by default), `lib/list.ts` `extraSelect`.
- Routes: three sample routers carry the gap columns on list/GET and accept `?address_missing=true`; PATCH enqueues `request_edited`; DELETE enqueues `deleted`. `search.ts` same. `clients.ts`: list/GET expose `address_missing` (+ `detail_request`), **new `POST /clients/:id/detail-requests`**, resolution hooks after every contact write (POST /clients existing-name, POST /:id/contacts, merge), delete/merge-source alerts. `consignments.ts` delete alert. `notifications.ts`: `outbox-pending` carries gap fields + `dedupe_key/payload/actor`, keeps deleted rows for their own `deleted` event, new arms for client/consignment; `outbox-mark` tolerates deleted rows; **new `GET /notifications/details-pending`** + **`POST /notifications/details-mark`**.
- `scripts/deploy-api.sh` applies 016 + 017. `test/helpers.ts` gained `reapplyMigrationsFrom()` (the 011 idempotency test recreated the old view and broke later tests).

### Agent
- `lib/client-guard.ts`: `assertDeliverable` → **`checkDeliverable`** (never throws for a missing detail; adds a name-only client shell for unknown receivers; still throws on ambiguity). `lib/names.ts` (`nameFromEmail`, `INTERNAL_EMAIL_DOMAINS`, `isInternalEmail`). `lib/current-user.ts`: `currentUser()` with email + name fallback from the email (fixes `logged_by: null`), `currentActor()` → `agent:<Full Name>`. `lib/api.ts` sends that as `x-actor`. `lib/notify.ts`: `resolveOrCreatePerson` (shared, refuses non-Sucafina emails), `touchRoster()` self-heal (fills a roster row's missing email from the chatting user).
- Tools: `upsert_client` never refuses (returns `missing_details` / `optional_missing`); `create_*` return `client_id, client_created, client_details_missing, client_details_optional, client_url`; `save_notify_contact` creates the client shell if needed and saves a CLIENT email as a client contact (`saved_as: client_contact`), never on the roster; **`request_missing_details`** (email-first, roster name, chain Sales Trader → account manager → nobody; Teams then email with QC + logger copied; records the ask; honest `{delivered, via, to, recorded, reason}`; injectable `deliver` for the harness); `find_open_samples` / `search_samples` / `record_dispatch` carry `address_missing` + who was asked.
- Jobs: `status-notifier` QC ping carries the ⚠ address line; deletions/edits go out as ONE grouped QC message per run (`lib/change-alerts.ts`). **`jobs/details-chaser.job.ts`** written (09:00 Nairobi Mon–Sat; nudge → escalate after 2) but NOT registered — that is v53, one job per version.
- Prose: persona (LOG FIRST / OUR TOOLS ONLY / loop-in = Sucafina colleague / ⚠ address pending on the card), `sample-intake` (CLIENT RESOLUTION, MISSING DETAILS routing rule, KEEP IN THE LOOP reworded to "Which Sucafina colleague…"), `dispatch-logging`, `client-book`, `status-and-tracking`. `grep -rn "REFUSE\|MANDATORY\|never create the sample first" src/` is clean.

### Dashboard
Amber **Address needed** badge/column/filter on the three books + clients list, detail-drawer strip and client-page banner with **Add address**; `ClientFormDialog` can now add a contact/address to an existing client (`useAddClientContact`); actor name prompt (`ActorPrompt`, `lib/actor.ts`, header chip) → `x-actor: dashboard:<Name>`; delete dialogs mention the QC alert; consignment delete now confirms; labels: placeholder SUCAFINA wordmark (`src/assets/sucafina-logo.svg`, swap for the real vector), `headline2` (outturn / PSS contract·container), book subtitle, consignment footer with outturns; "Removed on <date>" banner on deleted rows.

## 2. Deploy sequence (the USER runs every step; promote needs a standalone yes)

Order matters: **API → agent v52 → dashboard → (after soak) agent v53**. The agent's new tool POSTs to `/clients/:id/detail-requests` and the open list reads the new columns; the tool tolerates a 404 as `recorded:false`, but that is insurance, not the plan.

### 2.1 Commit (explicit paths — the repo is public; never add `CHOTU-CONTEXT-sucafina.md`, `popover-snap.md`, `sl-8008-drawer.png`, `docs/teams-agent-connect-instructions.md`)
```
git add api/ dashboard-v2/ src/ scripts/deploy-api.sh scripts/log-first-harness.ts scripts/loop-in-harness.ts scripts/tool-harness.ts package.json docs/qc-whats-new-2026-09.md docs/HANDOVER-2026-09-09-round6.md docs/feedback-status.md
git status --short            # confirm the four scratch files are still untracked
git commit -m "feat: log-first intake (Beyers) + QC change alerts + labels (round 6, agent v52)"
```

### 2.2 API (VPS)
```
git archive --format=tar.gz -o sucafina-deploy.tar.gz HEAD
rsync -avz sucafina-deploy.tar.gz root@156.67.105.74:~/
bash scripts/deploy-api.sh
```
Expect `== migration 016` → `CREATE FUNCTION`, `CREATE TABLE`, `CREATE INDEX`, 3× `ALTER TYPE`, `DROP VIEW`, `CREATE VIEW`; `== migration 017` → 7× `ALTER TABLE`, `CREATE INDEX`; Docker's `COPY . .` NOT "CACHED". Then:
```
curl -s https://sucafina-api.luameet.in/health
# RC7 data fix — dry run, read it, then apply:
ssh root@156.67.105.74 "cd /opt/sucafina && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api npx tsx scripts/fix-roster-externals.ts"
ssh root@156.67.105.74 "cd /opt/sucafina && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api npx tsx scripts/fix-roster-externals.ts --apply"
```
Expected dry run (as of 2026-09-09): Ayumi <tokeh-ukewatashi@itochu.co.jp> → Itochu; Maria Prieto <maria.prieto@es.nestle.com> → Nestlé España – NQCC BCN; Minette Rosen <minette.rosen@se.nestle.com> → Nestle. Verify: `GET /traders?all=1` shows them `active:false`, `GET /clients/<nestle id>` has `account_owner: null` and the email among `contacts`.

### 2.3 Agent v52
```
lua compile --ci
lua push all --ci --force
lua models set anthropic/claude-sonnet-5
lua version create -m "log-first intake (Beyers) + change alerts + roster guard"
lua version diff v51 v52
```
Expect: 6 skills bumped (sample-intake, client-book, dispatch-logging, status-and-tracking + the two untouched ones re-bundled), status-notifier bumped, persona bumped (v17), model unchanged `anthropic/claude-sonnet-5`, **jobs count unchanged (2)**. Then `lua version promote v52` — only on an explicit standalone yes.

### 2.4 Dashboard
`git push origin main` (Vercel auto-deploys). Safe any time after 2.2.

### 2.5 Agent v53 — after v52 soaks (sandbox executes tools; ~1 day live without regressions)
In `src/index.ts` uncomment `import { detailsChaserJob } …` and add it to `jobs: [dispatchNotifierJob, statusNotifierJob, detailsChaserJob]`; `lua compile --ci` → push → `lua models set …` → `lua version create -m "details-chaser job"` → `lua version diff v52 v53` (expect exactly one job added) → promote on a standalone yes.

### 2.6 Platform hygiene (server-state changes — each on an explicit go)
```
lua integrations disconnect --connection-id 6a4e52af2daf5368226b3272     # microsoftteamsbot MCP (Lua's own tenant)
lua integrations disconnect --connection-id 6a58c289a3292df31e868c23     # Gmail (MCP pending, unused)
lua integrations disconnect --connection-id 6a58c2a7a3292df31e868cf6     # Google Calendar (MCP pending, unused)
lua features disable --feature-name rag        # no resources uploaded
lua features disable --feature-name webSearch  # unused, billed
lua features disable --feature-name location   # unused, Google Maps billed
lua features disable --feature-name inquiry    # unused
```
Then ask Lua (Rares): what is the built-in `prepare_share` tool, and remove it from this agent. If Lua can't, ship v54 with `governance: { mode: 'sdk', rules: { blockTools: ['prepare_share'] } }` on the `LuaAgent` in `src/index.ts` — its own version, sandbox soak first (a July push once killed all tool execution). Also check org billing in the Lua admin dashboard (`Payment required` ×2 on 2026-09-08).

## 3. Prod QA script (after v52; `lua chat -e production -t <fresh thread id>`; run OUTSIDE the cron window — after 19:00 Nairobi or Sunday — so nothing reaches Harriet/Bernard while QA rows exist; soft-delete QA rows and clients afterwards, clear the thread)

| # | Send | Expect |
|---|---|---|
| 1 | `Please prepare a 2.5kg TYPE sample for QA Beyers 0909 of AB FAQ` | Echo `AB FAQ • 2.5 kg → QA Beyers 0909 • type • Commercial` + one confirm question. No address question. |
| 2 | `yes` | Card TYPE-1xx with "added QA Beyers 0909 to the book", `⚠ address pending`, ONE question "Who has the delivery address — you, or someone I should ask?", the nudges line, "QC will get a ping". |
| 3 | `keep <your own @sucafina.com or test inbox> in the loop, the lab has the address` | "…is now account manager" + "Asked <name> on Teams" / "Emailed <name> (QC desk + you copied)" + "I'll chase each morning until it's in." No further question. (With a non-Sucafina test inbox expect instead: saved as the client's contact + the loop-in question asked once more.) |
| 4 | `Add them as blank for now` | One line: already logged, nothing else needed. No refusal. |
| 5 | `status of TYPE-1xx` | Card incl. "address pending — asked <name>, 9 Sep". |
| 6 | `Rue du Rhône 1, 1204 Geneva, Switzerland, attn Tommie, +41 22 000 0000` | "Saved on QA Beyers 0909 — address on file." |
| 7 | `300g offer sample AA Sangalai, Kenya, for Sucafina Argentina` → `yes` | Card; no address/phone/email question at all. |
| 8 | `share a card with QC` | Refuses to use share cards; points to the automatic QC ping. |
| 9 | Delete the QA sample from the dashboard with your name set | Within the next tick QC's grouped "Sample request changes (1) — • DELETED …" (check `outbox-pending` for `event: deleted` first if outside the window). |

## 4. Handover prompt for Phases 3–5 (paste this to start the next session)

> You are continuing the Sucafina sample-management build in `/Users/devashishthapliyal/Documents/work/Lua/Sucafina`. Read `docs/HANDOVER-2026-09-09-round6.md` §1–§2 first (what shipped in round 6 and how it deploys), then the approved plan at `/Users/devashishthapliyal/.claude/plans/yo-so-we-got-wild-wilkes.md` — Parts C-C (purge), C-E (tracking) and C-B (contracts + PSS import) are the specs; Part D is the delivery order and verification. Conventions: TDD (vitest+supertest in `api/test`, RED before GREEN); idempotent migrations `api/migrations/NNN_*.sql` starting at **018** (`018_legacy_samples_soft_delete`, `019_tracking`, `020_contracts_pss`), each appended to `scripts/deploy-api.sh`; every alert rides `notifications_outbox` (`OUTBOX_EVENTS` in `api/src/lib/notify-outbox.ts` already lists `delivered, tracking_exception, pss_due_soon, pss_overdue, pss_rejected, pss_schedule_imported`; `outbox-pending` needs an arm per new tab — see the client/consignment `entityArm` pattern in `api/src/routes/notifications.ts`); agent jobs enter one per version (`tracking-sweep` = v54, `pss-schedule` skill = v55) and the user runs every deploy (`lua push all --ci --force` → `lua models set anthropic/claude-sonnet-5` → `lua version create` → `lua version diff` → promote only on a standalone yes); dashboard deploys by `git push origin main`; API by `git archive` + rsync + `bash scripts/deploy-api.sh`. Never commit `CHOTU-CONTEXT-sucafina.md`, `popover-snap.md`, `sl-8008-drawer.png`, `docs/teams-agent-connect-instructions.md` (public repo). Never add a Co-Authored-By trailer.
>
> **Phase 3 — purge before 2026-08-01** (decided: soft-delete samples, keep clients/roster/audit/ref counters): migration 018 adds `deleted_at` to legacy `samples`; write `api/scripts/purge-before.ts --before 2026-08-01 [--apply --backup-ack <dump>] [--restore <purge_ts>]` with a dry run that prints per-table counts, one transaction, one shared `purge_ts`, one `events` row per hidden sample (`deleted`, actor `script:purge-before`), pending outbox rows marked `purged`, empty consignments closed, refuse any other date without `--i-mean-it`; `api/test/purge-before.test.ts`; a `DetailDrawer` "Removed on" banner already exists. Hand the user the VPS command list (pg_dump to `backups/pre-purge-<date>.dump` first; run after 19:00 Nairobi). It runs only on an explicit go after the user reads the dry-run counts.
>
> **Phase 4 — DHL + FedEx tracking**: migration 019 (`tracking_status, tracking_last_event, tracking_last_event_at, tracking_checked_at, tracking_exception` on the three books + partial index on the dispatched-with-AWB pool); async `TrackingProvider` + `TrackingInfo` in `api/src/lib/tracking.ts`; `lib/tracking/dhl.ts` (Shipment Tracking – Unified, `DHL-API-Key`), `lib/tracking/fedex.ts` (OAuth2 client-credentials, `POST /track/v1/trackingnumbers`), `lib/tracking/registry.ts` (`providerFor(courier_norm)`; stub only when no key AND not production; in prod without a key answer `unknown` + "live tracking not configured", never fabricated), `lib/tracking/apply.ts` (persist; `delivery_update` event on change; delivered → `delivery_on` + status `delivered` unless `results_in`, outbox `delivered` → account manager, forwarding excluded; exception → outbox `tracking_exception` dedupe-by-reason → QC + account manager); `GET /tracking/:awb` live; `POST /tracking/sweep {limit=40, min_age_hours=4}`; agent job `src/jobs/tracking-sweep.job.ts` cron `0 7-19/2 * * 1-6` Nairobi → v54; `TrackAwbTool` richer shape; `status-and-tracking` prose "as of <time>", drop the prototype wording; env `DHL_API_KEY, FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET, FEDEX_API_BASE, TRACKING_DHL_DAILY_CAP=200, TRACKING_STUB_FALLBACK=false` in `docker-compose.prod.yml` + `.env.prod.example`. Fixture-driven provider tests + sweep tests. Blocked on credentials: DHL Express + FedEx account numbers and a Sucafina mailbox for the developer portals (DHL key immediate; FedEx sandbox key immediate, production key after review).
>
> **Phase 5 — contracts + PSS 45-day rule + SOL import** (asks b + d): migration 020 (`contracts` with `pss_due_date GENERATED ALWAYS AS (shipment_date - 45) STORED`, status machine open → pss_pending → pss_partial → pss_approved / pss_rejected; `pss_imports` staging; `contract_id, container_no, replaces_sample_id` on specialty+bulk); per-container status from live PSS rows (none / pending / approved / replacement_pending / failed at ≥2 rejections); on the FIRST rejection of a contract PSS the API auto-draws the replacement (same container, new SSKE ref, `replaces_sample_id`, outbox `created` flagged REPLACEMENT), the second flips the contract to `pss_rejected` (outbox → QC + account manager); `POST /imports/pss-schedule {file_url}` (API downloads from `cdn.heylua.ai`, parses xlsx/csv with the `xlsx` package added to `api/package.json`, PDF → 415 until a real one is seen, header synonym matcher, month-only dates, client matching exact → fuzzy → null) → preview → `POST /imports/pss-schedule/:id/commit` (idempotent; one PSS `bulk_samples` row per container; one grouped QC ping `pss_schedule_imported`); `POST /contracts/pss-sweep` (`pss_due_soon` dedupe D14|D7|D0, `pss_overdue` dedupe ISO-week) called at the top of every `status-notifier` tick; `GET/POST/PATCH/DELETE /contracts`, `GET /contracts/pss-due`, `POST /contracts/:id/link`; `GET /bulk-samples` gains `pss_due_date` via `extraSelect` + filters; agent skill `pss-schedule` (v55) with `import_pss_schedule` (preview, wait for an explicit go), `confirm_pss_import`, `list_pss_due`, `get_contract`, `link_sample_to_contract`; dashboard `ContractsPage` + `ContractDetailPage` (one card per container), sidebar entry, Commercial book columns. Build schema + manual contracts + status machine + sweep first; finalise the importer's default mapping against Harriet's real SOL export. Open questions for Harriet are listed in the plan under C-B.
>
> Finish each phase with: tests green, `lua compile --ci`, the exact user-run deploy commands, and an updated `docs/feedback-status.md` row.

## 5. Inputs still needed (do not block Phase 3)

Sucafina logo SVG · one real SOL PSS export · DHL/FedEx credentials · work emails for Ivo, Muki, Omar, Brian, Gloria · Harriet's answers (outturn layout; Commercial outturn column; PSS per container vs per contract; replacement-ref style; second-rejection handling; whether a later export cancels vanished contracts; who acts on a tracking exception) · Lua's answer on `prepare_share` · org billing status.

## 6. Gotchas learned this round

- The `priority-and-contacts` API test re-applied migration 011 alone, which recreates `all_samples_v` in its 2026-08 shape; use `reapplyMigrationsFrom('012')` after any single-file re-apply (deploy applies 011→latest in order).
- `lua compile` bundles with esbuild and does NOT typecheck — run `npx tsc --noEmit --strict --skipLibCheck --module ESNext --moduleResolution bundler --target ES2020 --esModuleInterop --resolveJsonModule src/index.ts src/jobs/details-chaser.job.ts scripts/*.ts` (the root `tsconfig.json` also sweeps `api/dist-v2` and is useless for this).
- `User.get()` works from the CLI session (the harnesses run as dev@luaimplementation.ai, which is NOT a Sucafina address — so the logger is never CC'd in local runs; expected).
- The local dev DB (`sucafina` on :5433) is not reset-able with `npm run migrate` (001 isn't idempotent); apply single files with `docker exec -i sucafina-postgres psql -U sucafina sucafina < api/migrations/<file>.sql`. 016 + 017 are applied locally.
- Never `git stash` while a subagent is editing the tree.
