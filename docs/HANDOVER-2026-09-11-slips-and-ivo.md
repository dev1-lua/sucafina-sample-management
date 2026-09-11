# Handover — 2026-09-11: Gloria's slip labels + Ivo's answers (10 Sep)

## 0. Where things stand (checked today, not assumed)

| Surface | State | Evidence |
|---|---|---|
| Git | `main` = `origin/main` up to `39dcc96`; today's commits (below) are local only | `git status -sb` at session start |
| Dashboard (Vercel) | deployed from `39dcc96` (auto-deploy on push) | origin/main == 39dcc96 |
| Agent | **v55 active** ("harriet updates", 10 Sep) = the whole tree **without** the three new primitives: `lua version diff v51 v55` shows only version bumps — no details-chaser, no tracking-sweep, no pss-schedule, persona v16 → v17 | `lua version list` / `diff` |
| API (VPS) | **not verified from here** — the local dashboard key is not the prod key. Confirm 016–021 went out: `curl -s -H "x-api-key: …" https://sucafina-api.luameet.in/contracts` → `{data:[…]}`, not 404 | — |

Version numbers moved on from the 10 Sep plan: `lua push all` auto-creates a version per job/preprocessor deploy (v52–v54 were those), so the old "v53/v54/v55/v56" names no longer map. Refer to versions by content below.

Side effect to know about: `lua sync --check --ci` **registered** pss-schedule, details-chaser and tracking-sweep on the server (ids now recorded in `lua.skill.yaml`, commit `f8cde73`) — nothing was pushed or versioned, and `lua compile` now reports "server sync skipped". The drift check also lists a server-only skill **`record-admin`** that is not in this repo — not touched; worth a look in the Lua console.

## 1. What landed today (all TDD, local `main`)

| Commit | What |
|---|---|
| `6766e1f` | **Ivo Q1/Q2**: the SOL export's shipment text `"2026/08 All - 2026/08 All"` (also `"2026/10 All"`, `"2026/10 - 2026/11"`) parses as the 1st of the window's earlier month — it was *unparseable*, so every row of a real export would have failed. The per-row "month — using the 1st" warning is gone (a month is the norm). **Ivo Q6**: a contract whose PSS is accepted (or shipped/cancelled) is skipped by a later import with the reason on the row; the commit re-checks under the row lock so a stale preview can't reopen it. A contract missing from a newer export is left alone (already so). pss-schedule skill states both. |
| `f8cde73` | server ids for the three new primitives in `lua.skill.yaml` (see §0) |
| `b1c74c3` | **Migration 022** `specialty_samples.stocklot`; PATCH can now fix `outturn`, `name`, `crop_year`, `stocklot` (it could not before — the label prints whatever the row says); `?q=` finds a lot by outturn/stocklot; a non-QC change to which lot is pulled raises the QC edit alert. `deploy-api.sh` now applies 011–022. |
| `9d4c4b5` | **Labels = Gloria's slips**: Kenyacof mark (traced from her slip into a vector; ring as true circles) on top, then bold `Stocklot · Outturn · Grower · Screen · Crop`; grower = wet mill before the "/" of `name`, minus a leading grade. Commercial/PSS/forwarding/consignment labels in the same style led by the ref. A small Code 39 strip with the ref stays under the slip. Stocklot column/create/edit + outturn/grower/crop editable on the Specialty tab. Placeholder SUCAFINA wordmark removed. |
| `93a5402` | agent: `stocklot` on specialty intake; QC alerts name outturn/stocklot/grower changes |
| `081704f` `b2f8ad5` `1a5ce6d` | **Crop line** (your call, 11 Sep): no crop year had ever been captured (0 of 1,063 specialty rows), so the slip never printed Crop. Now: a saved crop year wins; else the Oct–Sep season of the sample's logged date (print day for an undated row). Crop year + stocklot are remembered per outturn — a new sample of the same outturn inherits them (API, needs this deploy). Intake asks "Outturn, stocklot and crop year?" in one line and never blocks (agent, next version). |

Counts: API **367/367** (one earlier full run had a single failure in `change-alerts` "QC edits … queue nothing" that passed alone and on the re-run — the QC-name cache in `api/src/lib/actor.ts` has a 60 s TTL across test files; pre-existing, not touched). Dashboard **95/95** + typecheck + build. `lua compile --ci` **45 primitives** (7 skills, 32 tools, 4 jobs, 1 preprocessor). Agent `tsc` clean apart from the 4 parked legacy jobs (`user` possibly null), untouched.

## 2. Deploy sequence (you run every command; promote/purge only on your standalone yes)

### 2.1 API — carries 016–022 if 016–021 never went out; re-running them is harmless
```bash
git archive --format=tar.gz -o sucafina-deploy.tar.gz HEAD
rsync -avz sucafina-deploy.tar.gz root@156.67.105.74:~/
bash scripts/deploy-api.sh
# expect at the end: == migration 022 … ALTER TABLE · COMMENT ; Docker COPY not CACHED
curl -s https://sucafina-api.luameet.in/health
```
If 016–021 were NOT yet on prod, also run the RC7 roster clean-up (dry run, then `--apply`) from docs/HANDOVER-2026-09-10-deploy.md §1.1 and add the six tracking keys to `.env.prod` first.

### 2.2 Dashboard
```bash
git push origin main      # Vercel auto-deploys: slip labels, Stocklot field, editable lot fields
```
Spot-check: open a specialty sample → printer icon → the slip shows the round mark and the five lines; edit Stocklot in the drawer and print again.

### 2.3 Agent — the next version is the tree as committed
`39dcc96` registered all three new primitives in one go (the 10 Sep plan had one per version with a day's soak each). If you want to keep that plan, comment two of the three out of `src/index.ts` before pushing; otherwise:
```bash
lua compile --ci                      # 45 primitives
lua push all --ci --force
lua models set anthropic/claude-sonnet-5
lua version create -m "details-chaser + tracking-sweep + pss-schedule; stocklot; SOL month window"
lua version diff v55 <new>            # expect: + pss-schedule skill, + details-chaser, + tracking-sweep, sample-intake/status-notifier bumped; model unchanged
# lua version promote <new>           # ONLY on a standalone yes
```
Sandbox first: `lua test skill pss-schedule` with a CSV whose shipment column reads `2026/10 All - 2026/10 All` → preview shows 1 Oct / PSS due 17 Aug, no month warning.

### 2.4 After that — unchanged from 10 Sep
The governance guard + group-chat asks (`GROUP_ASKS_ENABLED`) stay their own version with the sandbox soak in docs/HANDOVER-2026-09-10-deploy.md §1.5. The purge run (§2 there) — the cutoff is now confirmed by Ivo; still only on your explicit go after the dry-run counts.

## 3. Still open

- **Gloria**: label stock/printer size (built 62 mm wide, height follows the content); keep or drop the small barcode strip under the slip; what `XAC100` is in Ivo's "42KS0001/XAC100/WETMILLNAME/GRADE" (if it is the stocklot or another mark, it is one field + one label line).
- **Q7**: one real SOL export (Excel/CSV) to confirm the column mapping — only the synthetic fixture has been read so far.
- DHL key (Daniel Chege), FedEx key (Brillian Cherono).
- API prod state (§0) and the `record-admin` server-only skill.
