# Handover — round 10 (22 Sep 2026): refs name the coffee, orders, richer pings, Teams group chats

Everything below is on `main` (merge of three worktree branches + docs). Nothing is deployed yet. Verification on main: API 415 tests + typecheck, agent 133 tests + `lua compile` 51 primitives (8 skills / 35 tools / 4 jobs / 2 preprocessors / 1 postprocessor), dashboard 141 tests + tsc + vite build. Feedback rows 46–53 in `docs/feedback-status.md`; talk track in `docs/walkthrough-2026-09-23.md`; Teams guide `docs/teams-loop-in-the-bot.md`.

## 0. Order matters

API first (the dashboard and the agent call endpoints that only exist after migration 023), then dashboard, then agent, then the Teams app.

## 1. API (VPS) — `bash scripts/deploy-api-round10.sh`

`scripts/deploy-api.sh` now takes a `pg_dump` backup into `/opt/sucafina/backups/` before replaying migrations 011–023. Migration 023 creates `lots` (one row per ref = one coffee), backfills it from the oldest live row per ref, lists refs whose rows carry different coffees in `lot_conflicts`, adds `client_id/requested_by/logged_by` to consignments, and rebuilds `all_samples_v` with `lot_sends` + `consignment_number`.

After the deploy, review the conflict list before applying it (on the dev seed it flagged 55 refs, mostly legacy junk refs like `DS` and `13/6247`; the apply re-issues every non-oldest row a fresh counter ref and tells QC old → new):

```bash
ssh root@156.67.105.74 'cd /opt/sucafina && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api npx tsx scripts/lot-conflicts.ts'
# once QC has seen the list (or you have pruned junk refs by hand):
ssh root@156.67.105.74 'cd /opt/sucafina && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api npx tsx scripts/lot-conflicts.ts --apply'
```

Smoke checks (replace KEY):
```bash
curl -s https://sucafina-api.luameet.in/health
curl -s "https://sucafina-api.luameet.in/lots?book=commercial&pageSize=3" -H "x-api-key: KEY" | head -c 400
curl -s "https://sucafina-api.luameet.in/samples/resolve?ref=SL-7336" -H "x-api-key: KEY"
```

## 2. Dashboard (Vercel) — push main

```bash
git push origin main
```
Vercel builds `dashboard-v2`. New: Sends / Coffees / Orders switch on Speciality + Commercial, ×N pill and Order column, drawer Related tab + In the loop, create dialog lot notice + multi-coffee order, consignment page (client, derived status, Dispatch all, member picker), client page orders card, Deliver-to line on slips, @sucafina.com rule on the Team page. Deep links: `/samples?view=coffees&ref=SL-7336`, `/bulk?consignment=CN-1012`.

## 3. Agent — version 78

```bash
lua compile --ci
lua push all
lua version create          # name it: round 10 — refs name the coffee, orders, Teams group chats
lua version diff v77 v78    # expect +3 tools (resolve_lot, who_is_in_this_chat, …), persona + intake/status skill text, GROUP_ASKS_ENABLED
lua version promote v78     # ONLY after the diff looks right
```
Rollback target stays v77. Changes: `resolve_lot` before every create (reuse / new / conflict prompt), 409 `ref_conflict` handled, orders via `create_consignment` with `{tab,id}` samples, one receiver-aware resolver on every ref-taking tool, `record_dispatch` by CN, QC ping grouped per order with client line + NEW CLIENT flag, CC both `kenyacof.specialtyqc@` and `kenyaqc@`, `Lua.request.conversation` participants (`who_is_in_this_chat`), `request_missing_details` resolves colleagues from the chat roster, `GROUP_ASKS_ENABLED = true`, lua-cli ^3.37.

Sandbox proof before promote (writes to prod — silence outbox first, clean with `scripts/sandbox-qa-outbox.mts`): (1) "300g AB FAQ type sample to Johanson" → "same coffee — reusing TYPE-973"; (2) "log TYPE-113 for C FAQ to Beyers" → clash prompt; (3) "AA, AB and C FAQ to EDMAX" → three refs + CN + one grouped QC email; (4) "where is SL-7336?" → sends listed.

## 4. Teams app 1.1.0 — publish + re-add

`lua-teams-app/manifest.json`: version 1.1.0, short name **Sucafina Sample Manager**, five resource-specific read permissions (`ChatMessage.Read.Chat`, `ChatMember.Read.Chat`, `ChatSettings.Read.Chat`, `ChannelMessage.Read.Group`, `TeamMember.Read.Group`). Zip it with `color.png` + `outline.png` → Teams Developer Portal → Publish to org (or Teams admin center → Manage apps → Upload). Then remove and re-add the bot in every group chat it is already in (permissions apply from the add). Ask Lua (Rares) for the retired shared-bot app id and have IT block/unpublish that entry so only one "Sample Manager" shows in the Forward dialog. Then run the soak test in `docs/teams-loop-in-the-bot.md`.

## 5. Data fixes (Team page or curl)

- Brillian: Team page → her row → email `brillian.cherono@sucafina.com` (or `PATCH /traders/<id> {"email":"brillian.cherono@sucafina.com"}`). Check the rest: `GET /traders?all=1` — Ivo / Muki / Omar / Brian / Gloria still have no email until they DM the bot once.
- Clean-up before 1 Aug 2026 (on Ivo's go, after the backup from §1): `docker compose … exec -T api npx tsx scripts/purge-before.ts --before 2026-08-01` (dry run) then `--apply --backup-ack /opt/sucafina/backups/<file>`.
- Tracking keys when they arrive: `DHL_API_KEY`, `FEDEX_CLIENT_ID`, `FEDEX_CLIENT_SECRET`, `FEDEX_API_BASE=https://apis.fedex.com` in `.env.prod`, then `docker compose … up -d api`.

## 6. Open questions for the team

Sucafina logo next to the Kenyacof mark on slips (no logo file exists)? Both QC mailboxes or one? One real SOL export for the PSS mapping (Q7)? Who else belongs on the Quality roster?

## 7. Known follow-ups (from the build reports)

- `client_created` on the ping is derived (client row < 10 min old and this is its first live sample) because the API never creates clients itself.
- The sample drawer fetches `GET /clients/:id` once to show the account manager; drops out if the API later joins it onto the row.
- Create dialog: rows already created before a 409/network failure are skipped on retry; later edits to them are not re-applied.
- `derived_status` treats a `dispatched`/`delivered` status as dispatched even without an AWB (superset of the contract).
- Commit `4c6030d` keeps a "wip" message; content is complete and tested.
