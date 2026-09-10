# Handover — 2026-09-10: Beyers group-chat fix, importer date fix, Harriet's answers — DEPLOY SEQUENCE

State: everything below is committed on `main` (see `git log 08523f5..HEAD`); **nothing is pushed to origin, nothing is deployed**. Prod: API on migration 015, agent **v51**, Vercel on 0f4c3a7. You run every command; a `lua version promote` and the purge run happen only on your standalone yes.

## 0. What landed today (one line each)

| Commit | What |
|---|---|
| `6ceaa98` | Group-chat asks (v56): `request_missing_details` posts into the Teams group chat it was raised in, addressed by name, still emails (QC desk + logger copied), records `via: 'group'`; `BLOCKED_PLATFORM_TOOLS` + commented `governance` block; persona/skill lines; preprocessor soak diagnostic; lua-cli pinned 3.32.6; `npm run harness:group-ask` (30 checks). Gated by `GROUP_ASKS_ENABLED=false` until v56. |
| `890ac0a` | Importer: CSV cells stay text — `01/12/2026` is 1 December (was 12 January). |
| `2f2fd7c` `34de503` `e11b5d7` | Harriet's answers: PSS = N lettered options × grams, refs `SSKE-<contract digits><letter>`, replacement = next letter on EVERY rejection, second rejection flags `pss_replacement_rejected` (and still draws), reminders QC-only, deleted refs reusable when latest, `po_ref` + grams per option, importer reads "quantity per sample" and the desk's client spellings, "Option" wording in dashboard + agent, Harriet's status vocabulary per row. Migration **021**. |
| `8e1a9be` | Deferred minors: option-letter race guard (unique index), re-point recompute, docs no longer say "simulated"/"prototype". |
| `d7b2d7c` | **Review wave** over the slice that was never reviewed (`31293c3..c6df43e`) — 4 Important + 2 Minor, each reproduced then fixed: a bag-count column could size every PSS; a parsed size had no bound (the importer writes contracts by SQL, bypassing the route's zod cap); two contract numbers with the same digits minted the same PSS ref (no unique index on either ref column → the agent refuses BOTH rows); a slot listed past the option count made a contract permanently uncountable and the 45-day reminder endless; `/link` took any sample into any slot; notification dates said "Sept" and a payload gap could print "undefined". Report: `.superpowers/sdd/you-are-continuing-the-zazzy-candy/final-review-2026-09-10.md`. |

Counts (all re-run after the review wave): API **361/361** (35 files), dashboard **92/92** + typecheck + build, focused agent `tsc` clean, `lua compile --ci` **37 primitives** (1 agent, 6 skills, 27 unique tools, 2 jobs, 1 preprocessor — the CLI counts a tool shared by several skills once; yesterday's "44" counted instances), harnesses **pss 30 / log-first 46 / group-ask 31** checks, all green.

Known and deliberately left: `api/test/notifications.test.ts` has 4 pre-existing `TS2352` casts under `tsc --noEmit` (that file is byte-identical to the session's start commit and vitest transpiles without typechecking) — not introduced here, not touched here.

## 1. Deploy sequence (in this order)

### 1.1 API — one deploy carries 016..021 (all idempotent)
Add the six tracking keys to `/opt/sucafina/.env.prod` first (blank is fine): `DHL_API_KEY= FEDEX_CLIENT_ID= FEDEX_CLIENT_SECRET= FEDEX_API_BASE=https://apis-sandbox.fedex.com TRACKING_DHL_DAILY_CAP=200 TRACKING_STUB_FALLBACK=false`. DHL keys come via **Daniel Chege**, FedEx via **Brillian Cherono** (the accounts are registered to them).
```bash
git archive --format=tar.gz -o sucafina-deploy.tar.gz HEAD
rsync -avz sucafina-deploy.tar.gz root@156.67.105.74:~/
bash scripts/deploy-api.sh
# expect: == migration 016 … 017 … 018 (ALTER TABLE, CREATE INDEX, 2× ALTER TYPE) … 019 … 020 … 021
#         021 prints exactly (verified by running it twice on the dev DB, ON_ERROR_STOP=1, exit 0):
#           ALTER TABLE ×8 · UPDATE 0 · COMMENT ×2 · CREATE INDEX ×2
#         (UPDATE 0 because prod has no contracts yet — 020 lands in this same deploy. A re-deploy adds
#          only "already exists, skipping" NOTICEs; the file is re-runnable.)
#         Docker COPY not CACHED
curl -s https://sucafina-api.luameet.in/health
# RC7 roster clean-up (dry run, read, then apply) — docs/HANDOVER-2026-09-09-round6.md §2.2
ssh root@156.67.105.74 "cd /opt/sucafina && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api npx tsx scripts/fix-roster-externals.ts"
ssh root@156.67.105.74 "cd /opt/sucafina && docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api npx tsx scripts/fix-roster-externals.ts --apply"
```
Post-deploy checks: `GET /contracts` answers `{data:[],…}`; `POST /clients/<id>/detail-requests` with `via:"group"` is accepted (201); `GET /traders?all=1` shows Tommie Schretlen with tommie.schretlen@sucafina.com (already true today); `psql -c "\\d contracts"` shows `po_ref` and `pss_qty_grams`, and the status CHECK lists `pss_replacement_rejected` (not `pss_rejected`).

### 1.2 Agent v52 — the whole tree as it is
```bash
lua compile --ci                      # 37 primitives
lua push all --ci --force
lua models set anthropic/claude-sonnet-5
lua version create -m "log-first intake + change alerts + tracking/PSS wording + group-ask tool (gated) + PSS options wording"
lua version diff v51 v52              # expect: 6 skills, status-notifier, current-datetime, persona bumped; model unchanged; jobs count 2
# lua version promote v52             # ONLY on a standalone yes
```
v52 carries the group-aware tool code but `GROUP_ASKS_ENABLED=false`, so `request_missing_details` behaves exactly as before (Teams DM, else email). It also carries the soak diagnostic: every Teams message logs one line `conversation: channel=teams id=… group=… source=… payloadKeys=[…]` — **read those in `lua logs --type preprocessor` after a message from a 1:1 AND from the desk group chat**; that is how we learn which field the platform carries the conversation id in (see §3).

### 1.3 Dashboard
```bash
git push origin main                  # Vercel auto-deploys; carries everything since 26 Aug
```
Spot-check: `/contracts` → "New contract" shows PO ref + Grams per option; a contract page says "PSS options".

### 1.4 v53 → v54 → v55 (one primitive per version, ~1 day soak each)
- v53: uncomment `import { detailsChaserJob }` + add it to `jobs` in `src/index.ts` → compile → push → models set → `lua version create -m "details-chaser job"` → `lua version diff v52 v53` (exactly one job added) → promote on yes.
- v54: same with `trackingSweepJob`.
- v55: same with `pssScheduleSkill` (import + `skills`). Sandbox first: `lua test skill pss-schedule` with `api/test/fixtures/sol-pss.csv` uploaded to cdn.heylua.ai, then Harriet's real "SAMPLES pending dispatch.xlsx" — check the preview reads "quantity per sample" as options × grams and matches "Zoegas / Nestlé Sverige", "Nestlé España (Japan destination)", "Marc Bang on behalf of CK CORPORATION".

### 1.5 v56 — the governance guard + the group-aware ask (its OWN version; the guard is the risky part)
1. In `src/index.ts` uncomment `governance: { mode: 'sdk', rules: { blockTools: BLOCKED_PLATFORM_TOOLS } }`.
2. In `src/lib/conversation.ts` flip `GROUP_ASKS_ENABLED` to `true`.
3. `npm run harness:group-ask` (still green), compile, `lua push all --ci --force`, `lua models set anthropic/claude-sonnet-5`.
4. **Sandbox soak BEFORE `lua version create`** (a July push once killed all tool execution):
   - `lua chat -e sandbox`: log a sample for a new client → the card + the address question must appear (tools still execute);
   - "share a card with QC" → refused, points to the automatic QC ping (prepare_share blocked);
   - "what Teams channels can you see?" → no channel listing (microsoftteamsbot_* blocked);
   - in the desk **group chat** (bot added + @mentioned once): "ask Tommie for the Beyers address" → the ask appears in that chat addressed to Tommie, Tommie gets the email with the QC desk copied, the reply says "Asked Tommie here in the chat (and by email)". `lua logs --type skill --name sample-intake` shows `request_missing_details: … delivered via group`.
   - If the group post does not land: read the `conversation:` log line — if `source=none` the platform carried no conversation id on `Lua.request.webhook.payload`; ask Lua (Rares) which inbound field carries it and extend `conversationFromPayload` (one function, harness-pinned). The DM/email path still works meanwhile.
5. `lua version create -m "block platform share/MCP tools + group-chat asks"` → `lua version diff v55 v56` (agent config + sample-intake + persona) → promote on yes.

## 2. Purge run (Phase 3) — unchanged from docs/HANDOVER-2026-09-09-phases3-5.md §4
After 1.1, after 19:00 Nairobi or on Sunday, ONLY on an explicit go after you read the dry-run counts. Expect counters unchanged: CN 1000 · SL 7459 · SSKE 108000 · TYPE 108 · _restart_2026_08 0. (SSKE stays at 108000 and is now only a fallback: contract PSS refs are contract-derived.)

## 3. Verified / NOT verified today
- Verified locally: the whole chain above with fakes (harnesses), the API against Postgres, the dashboard build. Tommie Schretlen is on the prod roster with his @sucafina.com email (checked via `GET /traders?all=1`).
- **NOT verified (needs the Lua runtime, i.e. you on sandbox):** (a) that `Lua.request.webhook.payload` carries the Teams `conversation` for a group message — the reader accepts the Bot Framework shapes (`conversation.{id,conversationType,isGroup}`, wrapped `activity.conversation`, flat `conversationId`) and logs what it saw; (b) the email leg end-to-end (`Channels.email.send` to tommie.schretlen@sucafina.com with the QC desk in CC) — the text already says REPLY ALL / dashboard link because the `ping@heymail.ai` inbox does not read plain replies; (c) that `governance.rules.blockTools` matches the runtime tool names (three seen in `lua logs --type mcp`: `microsoftteamsbot_list_messaging_channels`, `microsoftteamsbot_list_messaging_messages`, `googlemail_list_messaging_messages`; the rest follow the Unified.to pattern for the granted scopes and are harmless if unused).

## 4. Still open with Harriet / Gloria / Ivo
Q1 shipment date day vs period · Q5 vanished contracts · Q7 real SOL export + columns · Q8 PSS book (built: Commercial) · Q12 clean-up cutoff · Q13 labels. Built on the bracketed defaults of docs/HANDOVER-2026-09-09-phases3-5.md §6.
