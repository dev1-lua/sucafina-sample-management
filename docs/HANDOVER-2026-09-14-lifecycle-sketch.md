# Handover 2026-09-14 — the lifecycle sketch, applied

Everything below is committed-ready on the working tree (nothing pushed, nothing deployed). Tests: API 376 + 8 new, dashboard 97 + 1, agent 15 (new root vitest), `lua compile --ci` clean (45 primitives), log-first harness extended.

## 1. The sketch (whiteboard, 14 Sep)

Roles: client (external buyer) → **sales trader** (Ivo in the sketch) → **agent** → **Quality team** → DHL.

1. Client → trader: "pls send my client AB FAQ".
2. Trader → agent: "pls send AB FAQ to Sales Trader's client Baba Coffee".
3. Agent → trader: "ok, I need a few details. What's the address, how much coffee in the sample?"
4. Sample lands in the sample-management dashboard: it knows where the coffee goes, to whom, and who to warn/ask.
5. Agent → Quality: "sample has been added for review".
6. Quality, offline: prepare the coffee, raise the DHL request, add the client's details to DHL. Then they enter the **AWB** — "when AWB is added, it means the coffee is awaiting collection by DHL".
7. AWB entry → trader: "hey — your sample abc for CLIENT has an AWB, it'll be on its way soon".
8. Dashboard reflects the new state.
9. The trader now knows where the coffee is and can chase their client; Quality likewise.

## 2. What was already true, and what was not

| Step | Before 14 Sep |
|---|---|
| 1–2, 5, 8 | Built: Teams DM in, `created` → QC within 15 min (status-notifier), timeline note on every ping. |
| 3 | Inverted: row created first, quantity defaulted silently, address chased afterwards with "who has X's address?". |
| 4 | "Who to warn" = client account manager + explicit loop-ins only. |
| 6 | No "awaiting collection" state — a row with an AWB but not dispatched still read requested/preparing. |
| 7 | **Broken for the requester**: the AWB ping went to the account manager and loop-ins; `requested_by` / `logged_by` were never used for delivery. Wording: `AWB added for SL-7461: 1234567890 (dhl).` The dashboard saves AWB and Status as two one-field PATCHes, so QC entering AWB then Dispatched produced two pings in one run. |
| 9 | Depends on 7; DHL/FedEx keys still pending on Sucafina's side (#43). |

Decisions taken with Dev (14 Sep): requester + logger + account manager all in the loop; intake asks address + quantity **before** creating; derived awaiting-collection label, no schema change; the client dispatch email (#20) stays.

## 3. What changed

### API (no migration)
- `api/src/lib/notify-outbox.ts` — a `dispatched` enqueue closes any still-pending `awb_added` for the same row (`last_error = 'superseded: dispatched'`, mirrors `enqueueDeleted`). One ping, not two.
- `api/src/lib/detail-requests.ts` — `gapColumns()` now also returns `awaiting_collection` (AWB on file AND status in requested/preparing); `AWAITING_COLLECTION_WHERE` exported.
- `?awaiting_collection=true` on `/specialty-samples`, `/bulk-samples`, `/forwarding-samples`, `/search`; `/search` returns the flag; `/notifications/outbox-pending` carries it on every arm.
- Tests: `api/test/awaiting-collection.test.ts` (new), three new cases in `api/test/notifications.test.ts`.

### Agent
- `src/lib/notify.ts` — `autoLoopIns(names, traders)`: matches `requested_by` / `logged_by` to the roster (exact name, else unique shared word; ambiguous or unknown → `unresolved` with the reason). `notifyContactGap(clientId, { coveredBy })` returns no gap when the Sales Trader is reachable, so the loop-in question is only asked when neither the trader nor an account manager has an email on file.
- `src/jobs/status-notifier.job.ts` — loop events (preparing / dispatched / awb_added / delivered, plus the QC+loop ones) add the auto loop-ins; unresolved names land in the skip note. `traderMessage` rewritten: `Your sample SL-7461 (AB FAQ) for Baba Coffee has a DHL AWB 1234567890 — it'll be on its way soon.` / `SL-7461 (AB FAQ) for Baba Coffee is on its way — DHL AWB 1234567890.` (an AWB typed after the dispatch uses the second form). Every courier_norm has a label (no more "RIDER").
- `src/skills/sample-intake.skill.ts` — "LOG FIRST, ROUTE THE ASK" became **DETAILS BEFORE WRITING — ONE LINE, THEN LOG**: `find_client` / `get_client` now say `address_missing` (and `usual_pss_grams`), the agent asks once — both / address only / qty only — and any answer, including skip / don't know / ask X / one half, writes the row immediately and routes the gap exactly as before. The confirm echo always shows `Sales Trader:` and `Deliver to:`.
- `src/persona.ts` — ASK ONCE, THEN LOG; pings section names the trader and logger; AWAITING COLLECTION wording rule.
- `status-and-tracking` + `dispatch-logging` skills, `set_sample_status` — awaiting-collection phrasing ("has DHL AWB n, awaiting collection", never "on its way"); "DHL picked up SL-8007" → `record_dispatch` with no courier/AWB keeps the ones on file.
- `search_samples` / `find_open_samples` return `awaiting_collection`; `get_sample_status` passes the API row through.
- Tests: `src/lib/notify.test.ts`, `src/jobs/status-notifier.test.ts` (root `npm test` → vitest; `vitest.config.ts` only includes `src/**`).
- Harness: `scripts/log-first-harness.ts` gained the pre-create checks (find/get_client flags), the AWB-first-then-pickup path (awaiting flag, superseded ping, record_dispatch keeping courier/AWB).
- `lua.skill.yaml`: sample-intake, client-book, dispatch-logging, status-and-tracking → 1.0.26; status-notifier → 1.0.10.

### Dashboard
- `src/lib/tags.ts` — `STATUS.awaiting_collection` (indigo) + `sampleStatusTag(row)`.
- `src/tabs/round3-fields.tsx` — `SampleStatusCell` (pill shows "awaiting collection" in place of requested/preparing, tooltip with AWB + courier), `awaitingCollectionFilter`, `awaitingCollectionDetailField` ("Awaiting DHL collection — AWB n. Set Status to dispatched once picked up."; hidden otherwise). Wired into all three books. The drawer's Status select still shows and edits the stored value.

## 4. Deploy sequence (Dev runs every command)

1. **API first** (no migration; safe with the old agent + dashboard):
   ```
   cd api && npm test
   # usual: build tarball → rsync to the VPS → scripts/deploy-api.sh (idempotent migrations + up -d --build)
   curl -s -H 'x-api-key: …' 'https://sucafina-api.luameet.in/specialty-samples?awaiting_collection=true&pageSize=1'
   ```
2. **Dashboard**: `cd dashboard-v2 && npm test && npm run build`, commit, `git push origin main` (Vercel). Tolerates the old API (flag simply never true).
3. **Agent**:
   ```
   npx lua compile --ci
   npm run qa:sketch            # optional re-run of the sandbox conversation (see §7); resets yaml versions!
   grep -n "version" lua.skill.yaml   # sample-intake / client-book / dispatch-logging / status-and-tracking must read 1.0.26, status-notifier 1.0.10
   npx lua push all --force
   npx lua version diff v55 <new>
   npx lua version create -m "lifecycle sketch: trader hears on AWB, ask-once intake, awaiting collection"
   # promote only on an explicit go
   ```

Order matters only for step 3 after step 1 (the agent reads `awaiting_collection`).

## 7. Sandbox conversation QA (done 14 Sep, re-runnable)

`npm run qa:sketch` drives `lua chat -e sandbox` through two threads and prints every reply. Findings from the 14 Sep run, against the real model:

- **A — Type, unknown client, "skip":** one-line ask ("New client. One detail before I log it: what's … delivery address … quantity (defaults to 300g)?") → "skip" → phyto question (round 1 rule, abroad) → echo `… • Sales Trader: Ivo • Deliver to: ⚠ no address yet • Phyto: No` → card `TYPE-114 … ⚠ address pending` + the new "QC will get a ping … you'll hear the moment it has an AWB" line → loop-in question (Ivo's roster row has no email yet — expected; disappears once Ivo has DM'd the bot) → "where is TYPE-114?" → "still requested … delivery address still pending".
- **B — PSS, no usual size:** "Two things … What's … delivery address, and how much coffee for the sample (they have no usual PSS size on file)?" (+ the PSS contract check) → one answer with address + 500g → phyto → echo with `Deliver to: Kammenstraat 12…` → `SSKE-108293`, no ⚠, `address_missing=false` on the client.
- Fixed from the run: the echo once printed field labels instead of values → skill wording now says "ONE line of VALUES (never the field names)"; the persona used to promise courier/feedback/order reminders from jobs that are parked → replaced by the sketch's line.
- Not testable in the sandbox: the AWB → trader ping and "awaiting collection" (jobs are not pushed by `lua chat`; the prod API has no `awaiting_collection` until step 1). Covered by `api/test/awaiting-collection.test.ts`, the three outbox tests and `src/jobs/status-notifier.test.ts`.
- **Gotchas:** `lua chat -e sandbox` compiles + pushes skills/preprocessors to the sandbox on its own AND rewrites `lua.skill.yaml` versions back to the server's (1.0.25 / 1.0.9) — re-bump before `lua push`. Test rows land in the PROD book: the script silences their outbox rows (`scripts/sandbox-qa-outbox.mts silence`) and deletes them at the end; the deletion alerts are silenced too.

## 5. Risks / things to tell the team

- A trader whose roster name is ambiguous (two Brians) is not guessed: the ping's skip note names them. Roster emails for Ivo / Muki / Omar / Brian / Gloria are still the practical blocker (round-5 checklist).
- Ping volume: account manager + loop-ins + Sales Trader + logger, deduped by email. A QC member who logs a sample for a trader now also gets its status pings — as in the sketch; mention to Harriet.
- Ivo's #34 account-manager model is intact; only the *question* is skipped when the trader is reachable.
- The one-line ask reverses the strict "log first" rule from 8 Sep. It is one question, with explicit escape words, and every answer writes the row. If a stakeholder objects, the fallback is a one-paragraph revert in `sample-intake.skill.ts` + `persona.ts` (tools unchanged).
- Superseded-ping race: if the job fetched an `awb_added` seconds before the dispatch PATCH, at most one redundant ping that tick.

## 6. Verification done locally (14 Sep)

- `cd api && npx vitest run` → 36 files / 384 tests green (Docker `sucafina-postgres` on 5433; migration 022 applied to the local dev DB today).
- `cd dashboard-v2 && npx tsc --noEmit && npx vitest run` → 22 files / 98 tests green.
- root `npx vitest run` → 15 tests green; `npx lua compile --ci` → 45 primitives.
- `npm run harness:log-first` against the local API → ALL GOOD (60+ checks, including the eleven added today: pre-create flags, awaiting-collection, superseded ping, record_dispatch keeping courier/AWB). A first run on a dev DB with stale detail-request rows can show two chaser failures; they clear on rerun.
