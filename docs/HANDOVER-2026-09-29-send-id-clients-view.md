# Handover — round 11 (29 Sep 2026): Send IDs, QC-editable refs, Clients view

Source: the 28 Sep call (Ivo, Harriet, Daniel). Spec: `docs/ROUND11-SPEC-send-id-clients-view.md`.
Everything is on `main`; NOTHING is deployed yet. Round 10b (API 024, agent v94, dashboard) has been live since 23 Sep.

What changed, in one breath: every sample row now has its own **Send ID** (`SS-<n>`, minted by the database,
unique, never changes); the **reference keeps naming the coffee** and QC can now **edit it in the drawer**
(same-coffee or brand-new ref accepted, an existing ref of a different coffee refused with a plain-English
reason); the dashboard has a **Clients** view (one row per client, expand to see every coffee sent to them);
each view carries a one-line explainer; the agent quotes the Send ID on every card and accepts it anywhere a
ref is accepted, so "which receiver?" never comes up when someone names a send.

## What to tell the team (the 30-second version)

- **Reference = the coffee.** SL-7307 is one stock lot. Sent to five clients, it is still SL-7307 five times.
  A different coffee needs a different reference. Quality owns references and can now correct one in the drawer.
- **Send ID = the row.** Every send has its own SS number (first column everywhere). Say "SS-4123" to the bot or
  type it in search and you land on that exact send. Nobody needs the reference to find a row any more.
- **Views:** Sends = one row per send. Coffees = one row per reference (who got this coffee?). Clients = one row
  per client (what did this client get?). Orders = one CN parcel to one client. The hint beside the switch says
  the same thing.
- The "Sucafina NV shows espresso coffee" case from the call was a wrong ref in the source sheet (one ref, two
  coffees). 51 such refs were flagged on 23 Sep; QC fixes them by editing the ref in the drawer (or asks for the
  clean-up script per ref). See §4.

## 0. Order matters

API first (migration 025 backfills the Send IDs the dashboard and agent read), then dashboard, then agent.

## 1. API — migrations 011–025 replay + rebuild

Same mechanics as round 10b (`docs/HANDOVER-2026-09-23-pss-groups.md` §1, "manual equivalents"): archive HEAD,
rsync to the VPS, `bash scripts/deploy-api.sh` (pg_dump backup, migrations replayed, containers rebuilt).
`scripts/deploy-api.sh` already lists 025.

**025** adds `send_id` to the three sample tables, the `SS` counter (starts at 1000), `next_send_id()`, a
BEFORE INSERT trigger per table (covers routes, drawPss, the PSS importer, the seed script and raw SQL), a
BEFORE UPDATE trigger that keeps the id immutable, a chronological backfill of EVERY row (live and deleted,
ordered by send date then created_at) in one block reservation, a unique index per table, the enum value
`ref_changed`, and `all_samples_v` restated with 024's 34 columns untouched plus `send_id` (35) and
`option_letter` (36). Re-applying is a no-op (proven in the suite and by piping the file twice in review).

Expected first live Send ID on prod = SS-(1000 + total rows of the three tables incl. soft-deleted), so
roughly SS-4000..SS-5500. Old sheet rows get the low numbers.

Smoke after deploy (replace KEY):
```bash
curl -s https://sucafina-api.luameet.in/health
curl -s "https://sucafina-api.luameet.in/search?q=SS-1000&pageSize=1" -H "x-api-key: KEY"
curl -s "https://sucafina-api.luameet.in/client-sends?book=specialty&pageSize=2" -H "x-api-key: KEY"
curl -s "https://sucafina-api.luameet.in/lots?book=specialty&q=SS-1000&pageSize=1" -H "x-api-key: KEY"
```
And in psql on the VPS: `SELECT count(*) FROM all_samples_v WHERE send_id IS NULL` → 0;
`SELECT count(DISTINCT send_id), count(*) FROM all_samples_v` → equal.

New/changed endpoints: `GET /client-sends?book=&q=&client=&sort=&order=&page=&pageSize=` and
`GET /client-sends/:key?book=` (key = `id:<uuid>` or `name:<lower name>`, URL-encoded); `PATCH` on
specialty/bulk accepts `ref` / `sample_ref` (409 `ref_conflict` with `message`); `/search`, `/samples/resolve`,
`/lots?q=`, the book lists' `?ref=`, and every notification/reminder/digest shape carry or accept `send_id`.

## 2. Dashboard (Vercel) — `git push origin main`

Send ID is the first column on all three books, in Coffees and Clients child rows, the drawer header, order
members, client pages, the ⌘K search and the chaser. Ref is the first editable field in the drawer (Specialty
and Commercial) with a hint; a refused change shows the reason under the field. Client names in the Sends table
link to the Clients view. View hints sit beside the switch.

## 3. Agent — compile, push, version, diff, promote (yourself)

```bash
lua compile --ci                 # expect 51 primitives (8 skills / 35 tools / 4 jobs / 2 preprocessors / 1 postprocessor)
lua push all --force
lua version create               # name it: round 11 — send ids
lua version diff v94 <new>       # expect: persona + skill text (Send ID rule) + tool descriptions; model unchanged
lua version promote <new>        # ONLY after the diff looks right — Dev's explicit go
```
Rollback target: **v94**. No new tool; the persona card header becomes `**<ref> · <coffee>** · SS-<n>`, confirms
read `Logged SS-1234 — SL-7336 (3rd send) → TORCH`, and `SS-…` works wherever a ref does (dispatch, status,
result, priority, add to order) without a receiver question.

## 4. Still open on Sucafina's side

- **51 conflict refs** (23 Sep dry run): one ref, two coffees. QC either edits the ref of the wrong row in the
  drawer (the lot check tells them if the target ref is a different coffee) or names refs for the clean-up script.
- **Data dictionary** (Ivo): every column header defined per team. Nothing to build until it lands.
- **DHL / FedEx developer keys** (Harriet / Daniel): developer.dhl.com is a separate, free registration, not the
  MyDHL+ shipping login, which is why the login failed on the call. Same for FedEx Developer Portal.
- **Pre-August purge**: parked until the structure above is confirmed.

## 5. Verification on main (before deploy)

- API: 488 tests / 42 files (`cd api && npx vitest run`), typecheck clean. Live smoke in review against a scratch DB:
  sequential SS ids across tables, search/resolve/lots by SS id, ref edit 200 / 409 with message, clients view
  list + detail, outbox items carry send_id, 025 re-applied twice with no change.
- Dashboard: 171 tests / 31 files (`npm test`), typecheck + build clean.
- Agent: 177 tests / 17 files (`npm test`), `lua compile --ci` = 51 primitives.

Known, left as-is: a ref-edit race (two people editing the same ref at once) returns a 409 without the friendly
message; one unidentified API test flake seen once while a second API shared the test Postgres.
