# Handover — 2026-09-09 (evening): Phases 3–5 built on `main`, NOT deployed, final review NOT done

Start the next session by pasting §9. Everything below is the state at commit `c6df43e` on `main`.

## 0. One paragraph

Round 6 (log-first intake, QC change alerts, labels) was committed as `17e2c4f`. On top of it, 20 commits (`1278656`..`c6df43e`) deliver Harriet's three remaining asks: **Phase 3** purge of samples dated before 2026-08-01 (soft delete, reversible), **Phase 4** live DHL/FedEx tracking with a two-hourly sweep and delivered/exception pings, **Phase 5** contracts + PSS 45-day rule + SOL xlsx/csv import + `pss-schedule` agent skill + dashboard Contracts section. Test state: API 35 files / 338 tests, dashboard 92/92, `lua compile --ci` 44 primitives (three new primitives exist but are deliberately unregistered: details-chaser job v53, tracking-sweep job v54, pss-schedule skill v55). **Nothing is pushed to origin, nothing is deployed** (prod API is still on 015, agent v51 is active, Vercel is on 0f4c3a7). Phases 3, 4 and Tasks 5.1–5.3 were reviewed per task with every Important finding fixed; **Tasks 5.4–5.7 were not reviewed** and the **final whole-branch review was stopped before it reported** — one known Critical bug is listed in §2.

## 1. What is committed (all on `main`, per-task commits, no trailers)

| Phase | Commits | What |
|---|---|---|
| 3 purge | `1278656` `6b812d2` `6363dee` `09e6640` | migration 018 (`samples.deleted_at`, `event_type_t` deleted/restored); `api/src/lib/purge-before.ts` + `api/scripts/purge-before.ts` (dry run / `--apply --backup-ack` / `--restore <purge_ts>` / `--i-mean-it`); legacy `GET /samples` hides deleted rows; docs row 44 |
| 4 tracking | `12d2cd8` `7da8692` `1210c5c` `e808941` `a34f224` `8f5cf4d` `a995a71` `9b8fd5a` | migration 019 (5 tracking columns + sweep index); async `TrackingProvider`, registry (`providerFor`, `guessCourier`, stub only outside prod), DHL + FedEx providers (fixture-tested), `lib/tracking/reasons.ts`; `applyTracking`; `GET /tracking/:awb` live + `POST /tracking/sweep`; agent job `src/jobs/tracking-sweep.job.ts` (v54, unregistered), `status-notifier` routing sets `QC_EVENTS/LOOP_EVENTS/QC_AND_LOOP_EVENTS` + `trackingMessage`, prose de-"prototype"d, `scripts/tracking-harness.ts`; env keys in `docker-compose.prod.yml` (+ `NODE_ENV=production`) and `.env.prod.example`; docs row 43 |
| 5 contracts | `cd4d823` `c480a01` `18dec87` `31293c3` `f2a7151` `2559967` `e41c2a7` `c6df43e` | migration 020 (`contracts` with generated `pss_due_date`, `pss_imports`, `contract_id/container_no/replaces_sample_id` on both books, enum values contract/import); `issueRef(type, db)`; `api/src/lib/contracts.ts` status machine + `drawPss` + `maybeDrawReplacement` (first rejection auto-draws, second flips to `pss_rejected`); `/contracts` routes incl. `pss-due`, `pss-sweep`, `draw-pss`, `link`; bulk list `pss_due_date`/`container_no` + filters; outbox `contractArm`/`importArm`; SOL import (`lib/pss-mapping.ts`, `lib/pss-import.ts`, `routes/imports.ts`, fixture `api/test/fixtures/sol-pss.csv`); agent skill `src/skills/pss-schedule.skill.ts` + 5 tools (v55, unregistered), `pssMessage` wording, sweep call at the top of every notifier tick (silent 404), `scripts/pss-harness.ts`; dashboard `/contracts` + `/contracts/:id`, sidebar entry, `contract_status` tags, Commercial-book PSS columns/filters; docs row 42 |

Deploy script: `scripts/deploy-api.sh` applies 011 → 020 (header `011–020`). Root `package.json`: `harness:tracking`, `harness:pss`.

## 2. NOT done / known problems (do these first in the new chat)

1. **Critical — importer CSV dates.** `api/src/lib/pss-import.ts` reads CSV through SheetJS, which infers ambiguous `dd/mm/yyyy` values US-first: `01/12/2026` becomes 12 January instead of 1 December (unambiguous `20/10/2026` survives as text). Any SOL CSV date with day ≤ 12 gets a wrong PSS due date. Fix: parse CSV cells as strings (`XLSX.read(text, { type: 'string', raw: true })` or a plain CSV split) so `parseShipmentDate` sees the text; add a test that `01/12/2026` → `2026-12-01` through the csv path. Check the xlsx path for date-typed cells too.
2. **No review of Tasks 5.4–5.7** (importer, skill, dashboard, docs) and the **final whole-branch review was killed**. Re-run: one reviewer over `.superpowers/sdd/you-are-continuing-the-zazzy-candy/review-31293c3..c6df43e.diff` (203 KB) with the checklist in the plan's Verification table, then one fix wave.
3. **32 deferred minors** are listed with file:line in `.superpowers/sdd/you-are-continuing-the-zazzy-candy/progress.md` (git-ignored; keep the directory). Notable: POST auto-link resolves the free container outside the write transaction; `/link` accepts non-PSS samples; re-pointing a sample between contracts recomputes only the target; FedEx token cache not keyed per client and no in-flight de-dupe; DHL `HOLD_SIGNAL` needs "returned to sender/shipper" (bare "Returned" on a transit row does not flip); date shapes in notifier messages ("9 Sept 2026" vs the spec's "9 Sep"); stale repo docs still say tracking is simulated — `ARCHITECTURE.md:128,251,258`, `README.md:42`, `DEMO.md:84,126`.
4. **Harriet's answers** (§6) are pending; Phase 5 is built on the defaults in brackets there. The SOL column mapping was only tested against the synthetic fixture.
5. `docs/qc-whats-new-2026-09.md` now speaks in the present tense about the purge, tracking and contracts — send it only after the corresponding deploys.

## 3. Deploy sequence (you run every step; promote/purge only on a standalone yes)

Order: **API (016–020 in one go) → RC7 roster fix → agent v52 → dashboard push → v53 → v54 → v55 → purge run**.

```bash
# 3.1 API — one deploy carries 016..020 (idempotent). Add the six tracking keys to /opt/sucafina/.env.prod first (blank is fine):
#     DHL_API_KEY= FEDEX_CLIENT_ID= FEDEX_CLIENT_SECRET= FEDEX_API_BASE=https://apis-sandbox.fedex.com TRACKING_DHL_DAILY_CAP=200 TRACKING_STUB_FALLBACK=false
git archive --format=tar.gz -o sucafina-deploy.tar.gz HEAD
rsync -avz sucafina-deploy.tar.gz root@156.67.105.74:~/
bash scripts/deploy-api.sh
# expect: == migration 016 … 017 … 018 (ALTER TABLE, CREATE INDEX, 2× ALTER TYPE) … 019 … 020; Docker COPY not CACHED
curl -s https://sucafina-api.luameet.in/health
# RC7 roster clean-up (dry run, read, then apply) — see docs/HANDOVER-2026-09-09-round6.md §2.2
ssh root@156.67.105.74 "cd /opt/sucafina && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api npx tsx scripts/fix-roster-externals.ts"
ssh root@156.67.105.74 "cd /opt/sucafina && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api npx tsx scripts/fix-roster-externals.ts --apply"

# 3.2 Agent v52 — the whole tree as it is (tools/skills/persona/notifier incl. tracking + PSS wording; the 3 new primitives stay unregistered)
lua compile --ci                      # 44 primitives
lua push all --ci --force
lua models set anthropic/claude-sonnet-5
lua version create -m "log-first intake + change alerts + tracking/PSS wording (round 6 + phases 3-5 prose)"
lua version diff v51 v52              # expect: 6 skills, status-notifier, persona bumped; model unchanged; jobs count 2
# lua version promote v52             # ONLY on a standalone yes

# 3.3 Dashboard
git push origin main                  # Vercel auto-deploys; carries everything since 26 Aug

# 3.4 v53 — after v52 soaks (~1 day): uncomment the details-chaser import + add detailsChaserJob to jobs in src/index.ts
#     compile → push → models set → lua version create -m "details-chaser job" → diff v52 v53 (exactly one job added) → promote on yes
# 3.5 v54 — after v53 soaks: uncomment trackingSweepJob (import + jobs) → same dance → diff v53 v54 (one job added) → promote on yes
# 3.6 v55 — after v54 soaks: uncomment pssScheduleSkill (import + skills) → same dance → diff v54 v55 (one skill added) → promote on yes
#     sandbox first: lua test skill pss-schedule with api/test/fixtures/sol-pss.csv uploaded to cdn.heylua.ai, then Harriet's real file
```

## 4. Purge run (Phase 3) — after the API deploy in §3.1, after 19:00 Nairobi or on Sunday, ONLY on an explicit go after you read the dry-run counts

```bash
ssh root@156.67.105.74
cd /opt/sucafina && mkdir -p backups
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
$DC exec -T postgres pg_dump -U sucafina -Fc sucafina > backups/pre-purge-$(date +%F).dump && ls -la backups/
$DC exec -T postgres psql -U sucafina sucafina < api/migrations/018_legacy_samples_soft_delete.sql   # no-op after deploy
$DC exec -T api npx tsx scripts/purge-before.ts --before 2026-08-01                                   # DRY RUN — read the table
$DC exec -T api npx tsx scripts/purge-before.ts --before 2026-08-01 --apply --backup-ack backups/pre-purge-$(date +%F).dump
$DC exec -T postgres psql -U sucafina sucafina -c "SELECT prefix, next_val FROM ref_counters ORDER BY prefix"
# expect unchanged: CN 1000 · SL 7459 · SSKE 108000 · TYPE 108 · _restart_2026_08 0
# undo: $DC exec -T api npx tsx scripts/purge-before.ts --restore "<purge_ts printed by --apply>"
```
Dashboard spot-check: books show only Aug/Sep rows; an old deep link shows the "Removed on" banner.

## 5. Credentials / inputs still needed

DHL Express account number + a Sucafina mailbox for developer.dhl.com (key immediate); FedEx account number + same mailbox for developer.fedex.com (sandbox immediate, prod after review); one real SOL PSS export (xlsx/csv, not PDF); Sucafina logo SVG; work emails for Ivo, Muki, Omar, Brian, Gloria; Lua's answer on `prepare_share`; org billing status.

## 6. Questions for Harriet (defaults in brackets are what is built)

1. Is the SOL shipment date a single day or a period/month? If a month, is "45 days before the 1st" right? [a day; month-only → 1st, flagged]
2. One PSS per container, or one per contract? [one per container]
3. How is a replacement PSS referenced today — fresh SSKE number or a suffix like "…D-F"? [fresh SSKE, linked to the rejected one]
4. After a second rejection on the same container — flag the contract, draw a third PSS, or something else? [flag "PSS rejected", ping QC + account manager, no third draw]
5. When a newer SOL export no longer lists a contract — cancel it automatically or leave it? [leave it; manual cancel]
6. Who gets the PSS reminders (14/7/0 days before due, weekly while overdue)? [QC + the client's account manager]
7. Which columns does the SOL export have, and can you send one real export (Excel or CSV)? [column names guessed]
8. PSS rows in the Commercial book (SSKE refs) or Specialty? [Commercial]
9. Replacement PSS quantity: 1 kg like the original? [1 kg]
10. Who should act on a courier exception (customs hold, address problem, return)? [both QC and the account manager are pinged]
11. DHL Express + FedEx account numbers and a Sucafina mailbox for the developer portals.
12. Confirm the clean-up cutoff: hide everything dated before 1 August 2026 in all books, regardless of status? [yes, all statuses]
13. Labels: which part of the outturn should be large, and should the Commercial book get an outturn column?

## 7. Rulings made on your behalf this session (undo any you disagree with)

- Worked directly on `main`, per-task commits, no branch — matches the git-archive/push-main deploy process. Cost if wrong: WIP commits on main; squash/reset before pushing if you prefer.
- Batched tasks into one implementer where they shared a test file or interface (3.1–3.3; 4.1–4.3; 5.1–5.3; 5.5–5.7).
- Purge: `--restore` now restores a consignment's PRIOR status (the plan's SQL forced `open`); the close-set is recomputed inside the transaction; `--backup-ack`/`--before`/`--restore` reject missing values or values starting with `--`.
- Tracking: DHL `transit` rows flip to `exception` only on a hold signal (`on hold`, `held`, `customs hold/delay`, `clearance delay/hold`, address problem, refused, returned to sender, damaged) and never when the text says complete/cleared/released — the plan's `/held|hold|clearance|customs/i` would have raised a customs alert on "Clearance processing complete". Reason regex shared in `lib/tracking/reasons.ts`. `NODE_ENV=production` added to the prod compose (it was never set; without it the stub gate would be open in prod).
- Contracts: `pss_counts` counts only containers 1..`pss_expected`, one bucket per container (the plan's SQL let an unassigned approved row push `pending` negative); `/draw-pss` and `/link` lock the contract `FOR UPDATE`; a result flip-flop cannot draw a second replacement; the sweep reports rows actually queued (`enqueueOutbox` returns a boolean); deleted contracts never draw; `containers`/`pss_expected` capped at 50; pg unique violations map to 409 globally.
- Phase 4 notifier: the four `pss_*` events were put in the routing sets before their wording existed; `traderMessage` got an explicit `dispatched` arm and a neutral fallback in 5.5.
- Reviews skipped for 5.4–5.7 and the final review stopped — at your instruction.

## 8. Gotchas learned

- Never let two agents run the API tests at once: both use `sucafina_test` with `resetDb()`; concurrent runs look like random flakes.
- `lua compile` bundles from `src/index.ts`; a commented import keeps a primitive out of the count (44). Focused tsc list now: `src/index.ts src/jobs/details-chaser.job.ts src/jobs/tracking-sweep.job.ts src/skills/pss-schedule.skill.ts scripts/*.ts`.
- `downloadImportFile` is https-only with an allow-list (`cdn.heylua.ai` + `IMPORT_ALLOWED_HOSTS`); http is allowed only for loopback hosts explicitly listed (harness use).
- The local dev DB (`sucafina` on :5433) has 016–020 applied and harness leftovers (counters SL 7486 / SSKE 108290 / TYPE 120 — not prod).
- The SDD workspace `.superpowers/sdd/you-are-continuing-the-zazzy-candy/` (git-ignored) holds the ledger, briefs, reports and review packages — keep it for the next session.

## 9. Prompt for the next chat (paste as-is)

> You are continuing the Sucafina sample-management build in `/Users/devashishthapliyal/Documents/work/Lua/Sucafina`. Read `docs/HANDOVER-2026-09-09-phases3-5.md` fully first (state at commit c6df43e: Phases 3–5 built on main, nothing pushed/deployed, final review not done). Then, in this order: (1) fix §2.1 (importer CSV dates parsed US-first — make CSV cells strings before `parseShipmentDate`, add the `01/12/2026 → 2026-12-01` csv test, check xlsx date cells); (2) run ONE review of the unreviewed slice `31293c3..c6df43e` (importer, `pss-schedule` skill + notifier wording, dashboard Contracts pages, docs) using the plan's Verification table in `/Users/devashishthapliyal/.claude/plans/you-are-continuing-the-zazzy-candy.md` and fix Critical/Important findings in one wave; (3) triage the deferred minors in `.superpowers/sdd/you-are-continuing-the-zazzy-candy/progress.md` — fix the stale "simulated tracking" wording in ARCHITECTURE.md/README.md/DEMO.md; (4) update `docs/feedback-status.md` only if anything changed; (5) hand me the deploy sequence from §3 (I run every command; promote and the purge only on my standalone yes). Conventions: TDD with vitest+supertest in `api/test`; idempotent migrations (next is 021); every alert rides `notifications_outbox`; agent primitives one per version (v53 details-chaser, v54 tracking-sweep, v55 pss-schedule — all written, all unregistered); never commit CHOTU-CONTEXT-sucafina.md, popover-snap.md, sl-8008-drawer.png, docs/teams-agent-connect-instructions.md; no Co-Authored-By trailer; never "prototype/simulated" in agent prose or UI; never run two API test suites concurrently.

## 10. Harriet's answers (2026-09-10) + the "SAMPLES pending dispatch.xlsx" sheet — what changes before Phase 5 ships

Source: Harriet's reply to §6 (blue text) and `~/Downloads/SAMPLES  pending dispatch.xlsx` (sheets "Pending Dispatch" 14 rows, "Dispatched" 9 rows). Questions 1, 5, 7, 8, 12, 13 were delegated to Gloria and Ivo — still open.

### Answers → required changes (do these in the next session, before v55 / any SOL import)

| # | Harriet said | Built today | Change |
|---|---|---|---|
| A | Deleted sample refs CAN be reused, provided the ref is the next sequential number | counters only ever advance | On soft-delete, if the row's ref equals `next_val − 1` for its prefix (SL / TYPE), decrement the counter so the next request reuses it. Otherwise nothing. Test both cases. |
| B | One PSS per container vs per contract "depends on the client": some want their own **PO ref**, JDE wants "a PSS per PO", CK wants "2 different PSS options (500 g per option)" per quality | one PSS row per container, `pss_expected` defaults to `containers` | Model a PSS request as **N lettered options** (A, B, C…) of X g each, per quality; `pss_expected` is free (not tied to containers); add `po_ref` on the contract and an option letter on the sample row; `container_no` becomes the option index (rename in UI to "Option"). |
| C | Replacement keeps the SSKE contract number; the **suffix moves to the next letter** and marks it a replacement | fresh counter ref `SSKE-108xxx` | **SSKE refs are contract-derived, not counter-issued** (sheet: SSKE-103503, SSKE-109646, SSKE-104929D-F). PSS ref = `SSKE-<contract digits>` + option letter(s); replacement = next unused letter(s) (a 3-option PSS A–C replaced → D–F). Stop calling `issueRef('pss')` for PSS; keep the SSKE counter only as a fallback for a PSS with no contract. **Collision risk today:** our counter starts at 108000 and the sheet already has real SSKE-108575 / 108577 / 108792. |
| D | Second rejection: flag the contract **"PSS Replacement Rejected"** AND draw the third sample with the next letter | second rejection → `pss_rejected`, no third draw | Rename the status to `pss_replacement_rejected`; keep drawing on every rejection (next letters); the flag stays until an approval. Status labels in dashboard/agent/notifier follow. |
| E | Reminders (14/7/0 d + weekly overdue) → **QC only** | QC + account manager | Move `pss_due_soon` and `pss_overdue` from `QC_AND_LOOP_EVENTS` to `QC_EVENTS` in `src/jobs/status-notifier.job.ts`; `contractArm` recipients unused for those two. |
| F | DHL account is registered with **Daniel Chege**, FedEx with **Brillian Cherono** | keys blank | Ask them for the developer-portal keys (§5). |
| G | Shipment issues: DHL Kenya contacts both QC and the account manager | both pinged | No change. |

### What the sheet itself shows (feeds the SOL mapping and the PSS model)
- Columns: `sample ref · Client · <unnamed: shipment month or sample type> · Quantity PER SAMPLE · Quality · Status · Phyto · Courier · Destination · ADDRESS`. Add `quantity per sample` (e.g. "4x1kg", "3x600grams", "2x500 grams") to the importer's synonyms and parse it as `options × grams`.
- Quantities are client-specific: Nespresso 4–8 × 1 kg, Zoegas 3 × 600 g, JDE 1–2 × 300 g, Itochu/CK 2 × 500 g. Q9's "1 kg" default is wrong — default from the client's last PSS, else ask.
- Their status vocabulary: "Pending PSS dispatch", "PSS dispatched", "Pending PSS results", "Sample approved", "Replacement PSS requested after rejection", "Pending Replacement Results", "Pss replacement rejected". Map these to ours in the dashboard/agent wording (a replacement row = `status requested` + `replaces_sample_id`).
- Client naming in the wild: "Zoegas / Nestlé Sverige", "Nestlé España (Japan destination)", "Marc Bang on behalf of CK CORPORATION" — the fuzzy client matcher must tolerate "X / Y", "(… destination)" and "on behalf of"; destination ≠ client country is normal.
- Two rows are the incident samples: `SL-7473` Connect Coffee (hand delivery by rider — the phone-number block) and `Type-115` Beyers.

### Still open (Gloria / Ivo): Q1 shipment date day vs period; Q5 vanished contracts; Q7 SOL columns + one real export; Q8 PSS book (sheet suggests Commercial with SSKE refs); Q12 clean-up cutoff; Q13 labels.
