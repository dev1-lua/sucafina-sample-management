# Handover — round 10b (23 Sep 2026): Commercial Coffees view + SSKE contract groups

Harriet's two asks from the 22 Sep call, plus three follow-ups from the prod dry run. Everything is on `main`; nothing is
deployed yet. Round 10 (API 023, agent v86, dashboard) has been live since 22 Sep. Verification on main: see §6.

What changed, in one breath: a PSS ref `SSKE-104929A/B/C` is now ONE coffee group `SSKE-104929` (the contract) with the
lettered options underneath; the Coffees view does this on the Commercial book as well as Specialty; rows logged before
round 10 that shared a client and an AWB become orders; the coffee match tolerates the sheet's spelling without merging
grades; the conflict clean-up issues one new ref per coffee across all flagged refs.

## 0. Order matters

API first (migration 024 re-keys the SSKE lots the dashboard and agent read), then dashboard, then agent.

## 1. API + orders backfill + dashboard — `bash scripts/deploy-api-round10b.sh`

One script, six steps, two prompts:

1. `git archive` HEAD → rsync to the VPS.
2. `scripts/deploy-api.sh`: pg_dump backup into `/opt/sucafina/backups/`, migrations 011–**024** replayed (all idempotent),
   containers rebuilt. **024** adds `lot_ref()` (SSKE-<digits><letter> → SSKE-<digits>), the softer `normalize_quality()`,
   merges lettered SSKE lots into their contract lot (oldest coffee kept), recomputes every `coffee_key`, rebuilds
   `lot_conflicts` from scratch, and recreates `all_samples_v` with `lot_sends` counted per contract group.
3. Smoke: health, a commercial lot page, an SSKE group (expect `"options":[…]`), `/samples/resolve?ref=TYPE-113`.
4. **Orders backfill** — dry run prints every group of live rows dated **since 2026-08-01** (`BACKFILL_SINCE=…` to change) that
   share client + a real AWB (≥ 4 digits; "HD" and other placeholders are skipped and counted) and have no order yet (e.g. Parlor
   Coffee's three coffees of 2026-09-02 on DHL 8309842892), then asks `y/N` before creating one consignment per group
   (`notes = backfilled from AWB <awb>`, client linked by id or by exact client name, requester/logger copied when the rows
   agree, `created_at` = the earliest send date). Re-running is a no-op. Without the floor the legacy sheet yields ~300 orders
   back to 2023 (one AWB per box of samples) — that is why the floor is on; eyeball the date spans and the "(no client on
   file)" lines before saying y.
5. **Fresh lot-conflicts dry run** (read-only). With the softer match the list should be far shorter than the 60 of 22 Sep; what
   remains is a genuine different outturn or grade under one ref. Apply ONLY named refs, after QC has seen them:
   ```bash
   ssh root@156.67.105.74 'cd /opt/sucafina && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api npx tsx scripts/lot-conflicts.ts --ref TYPE-1234,SL-5678 --apply < /dev/null'
   ```
   Never `--apply` without `--ref`. TYPE-115 / TYPE-116 (issued 22 Sep for Beyers' and Sarutahiko's AB FAQ) are the same
   coffee; if QC wants one ref, re-ref the TYPE-116 row to TYPE-115 in the drawer (the lot check will accept it: same coffee).
6. `git push origin main` → Vercel builds `dashboard-v2`.

Manual equivalents, if you prefer them one at a time:
```bash
git archive --format=tar.gz -o sucafina-deploy.tar.gz HEAD && rsync -avz sucafina-deploy.tar.gz root@156.67.105.74:~/
bash scripts/deploy-api.sh
ssh root@156.67.105.74 'cd /opt/sucafina && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api npx tsx scripts/backfill-orders.ts --since 2026-08-01 < /dev/null'          # dry run
ssh root@156.67.105.74 'cd /opt/sucafina && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api npx tsx scripts/backfill-orders.ts --since 2026-08-01 --apply < /dev/null'  # apply
ssh root@156.67.105.74 'cd /opt/sucafina && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api npx tsx scripts/lot-conflicts.ts < /dev/null'            # fresh dry run, read-only
git push origin main
```

## 2. Dashboard (Vercel) — arrives with the push in §1

Coffees view on Specialty AND Commercial: one row per ref, expand for every send. PSS group row:
`SSKE-104929 · <contract client> · options A, B, C`; child rows carry the option letter. `?ref=SSKE-104929A` opens the
group. Orders view shows the backfilled orders (Parlor Coffee → one CN with three coffees).

## 3. Agent — next version after v86

```bash
lua compile --ci                 # expect 51 primitives (8 skills / 35 tools / 4 jobs / 2 preprocessors / 1 postprocessor)
lua push all --force
lua version create               # name it: round 10b — PSS contract groups
lua version diff v86 <new>       # expect: resolve_lot tool text + intake/pss-schedule skill text; persona + model unchanged
lua version promote <new>        # ONLY after the diff looks right — Dev's explicit go
```
Rollback target: v86. Change: `resolve_lot` says "SSKE-104929 has options A, B; this will be C" for a PSS group; skill text
tells the model the lettered options are one contract group.

## 4. Screenshots for the call (`.playwright-mcp/`, taken on the seeded dev DB with 024 applied, git-ignored)

| File | Shows |
|---|---|
| `2026-09-23-commercial-coffees.png` | Commercial → Coffees: one row per ref (TYPE / SL / SSKE), sends count, status roll-up, last send, last receiver — 685 coffees |
| `2026-09-23-commercial-type-973-expanded.png` | `?ref=TYPE-973` deep link: the coffee opened with its three sends (JOH JOHANSON ×2, RIVERFRONT) — date, qty, courier/AWB, status, order |
| `2026-09-23-commercial-sske-103503-group.png` | `?ref=SSKE-103503B` opens the contract group `SSKE-103503 · Nestrade SA · options A, B, C`; child rows carry the option letter |
| `2026-09-23-commercial-orders.png` | Commercial → Orders after the backfill (one order per client + AWB) |
| `2026-09-23-specialty-coffees.png` | Speciality → Coffees: `SL-7336 · 11KN0053 · AA · WOC samples`, 3 sends, `2 dispatched · 1 pending` |

## 5. Talk track for Harriet (5 minutes)

1. **Commercial → Coffees** (30 s). "Every row here is one coffee — one ref. The Sends count says how many times it went out."
2. **Expand a TYPE ref** (1 min). Point at the child rows: each client, each date, qty, courier/AWB, status, order. "This is the
   trace you asked for: which sample of this coffee went to which client, and when."
3. **Expand an SSKE group** (1 min). "Your PSS options A, B, C now live under one line, the contract. The option letter is on each
   row. Typing SSKE-104929C for the same contract adds option C to the group — it never clashes."
4. **Search** (30 s). Type `SSKE-104929B` in the box: the group opens. Type a client's name: every coffee that went to them.
5. **Orders → Parlor Coffee** (1 min). "Three coffees sent on 2 Sep on one DHL AWB are now one order, CN-xxxx — the same way new
   requests are grouped since Monday."
6. **Close** (1 min). The conflict list: "With the sheet's spelling forgiven (AB-FAQ = AB FAQ, Grinder = Grinders) only N refs
   still carry two coffees — here they are; tell us which to split." Then the still-open items in §7.

## 6. Verification on main (23 Sep, HEAD after the fix wave)

| Layer | Result |
|---|---|
| API | `npm test` 446 passed (39 files; was 415 on 22 Sep), `npm run typecheck` clean |
| Agent | `npm test` 156 passed (16 files; was 133), `lua compile --ci` 51 primitives (8 skills / 35 tools / 4 jobs / 2 pre / 1 post) |
| Dashboard | `npm test` 149 passed (30 files; was 141), `tsc --noEmit` clean, `vite build` OK |
| Dev DB (seeded, 023 + 024) | lots 1770 → 1376 (502 lettered SSKE lots → 215 contract groups, none lettered left); lot_conflicts 55 refs → 45 — every remaining one is a different outturn or grade (the AB-FAQ / Grinder / TYPE SAMPLE noise is gone); replaying 023→024 twice changes nothing |
| Orders backfill (dev DB, `--since 2026-08-01`) | 24 orders from 175 rows, 24 placeholder-AWB rows skipped, second `--apply` a no-op; without the floor the sheet yields 317 orders back to 2023 |
| Review | one whole-branch review (bd0da45..HEAD): 0 Critical, 5 Important — all fixed (see §8) — then a scoped re-review of the fix commits: all closed, no new Critical/Important, verdict ready to merge |

## 7. Still owed by Sucafina (carried from round 10)

- Teams app 1.1.0: publish `lua-teams-app/manifest.json` (zip with `color.png` + `outline.png`) and re-add the bot to every
  group chat it is in; remove the old shared "Lua Sample Manager" entry (ask Rares for its app id).
- Brillian's email on the Team page (`brillian.cherono@sucafina.com`).
- DHL / FedEx API keys → `.env.prod`, then `docker compose … up -d api`.
- Ivo's go for the pre-1-Aug purge (`scripts/purge-before.ts`, after a backup).
- Sucafina logo file for the labels; one real SOL export for the PSS import mapping; both QC mailboxes or one.

## 8. Known follow-ups / parked review findings (one whole-branch review, 23 Sep; rulings below)

Fixed in this round (Important): all-noise qualities (`Kenya`, `Washed`, `Arabica`…) no longer collapse onto one empty coffee
key; a typed lettered SSKE ref keeps its own letter when the row auto-links to the contract; a group-chat ask no longer
suppresses the Teams DM of a colleague who is not in that chat; the agent's ref normaliser now matches the API's (the sheet's
`SSKE 95986 D` joins its contract group instead of minting `SSKE-95986-D`); the dashboard accepts the same spelling; the backfill
re-checks each row inside its transaction; "where is SSKE-104929?" answers per option.

Parked (Minor, with the ruling):
- `%` glued to a word (`grinders%`) normalises differently in TS vs SQL — unrealistic input; revisit if a real quality carries it.
- `drawPss` counter fallback `SSKE-<counter><letter>` can file an option under another contract's digits; only reachable when the
  derived ref is already taken. Leave until a real collision shows up in the dry run.
- backfill-orders: a client+AWB group with SOME rows already in an order gets a second order for the rest (rows are never
  re-attached). Acceptable for a one-shot backfill; the dry run shows it.
- Order ping link opens the first member's book only; a two-book order links to one book. `outbox-pending` LIMIT 100 could split a
  very large order across two runs. Both cosmetic at current volumes.
- lot-conflicts: re-issuing a `pss`-typed flagged row mints a counter `SSKE-` ref that reads like a contract group — apply
  `--ref` only to SL/TYPE refs; PSS groups are excluded from the conflict list anyway.
- Design note: `/` always splits a blend (`AA/AB` is a blend, `AB/FAQ` is two parts); the brief's "in-token `/` → space" was not
  built because it would have merged real blends. Tests pin the split.
- After the fixes (re-review, Minor): a row whose ref IS the bare `SSKE-<digits>` (typed base with an option letter) is found by the exact
  status lookup first, so "where is SSKE-556101?" answers that one row, not the whole group; and the raw-text fallback of the coffee
  key keeps punctuation (`Kenya.` ≠ `Kenya`) — a false non-merge only.
- Legacy data: rows whose outturn matches but grade is blank (`03KF0013` vs `03KF0013 AB`) still count as different coffees —
  a blank grade is not "any grade". QC decides per ref via `--ref`.
