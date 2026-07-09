# Fetch QA — "can the agent fetch everything?"

**Date:** 2026-07-08
**Target:** production agent (`baseAgent_agent_1783420556773_cc6qh9f2y`) + production API `https://sucafina-api.luameet.in`
**Method:** ask the live agent read questions via `lua chat -e production`, compare each answer to direct API ground-truth (`/stats`, `/search`).

## TL;DR

**No — not for large result sets.** The agent is correct on simple counts that map to a single API `total`, but it **cannot list beyond the first page** and **reports a wrong total for "awaiting results."** Two hard failures, both fixed in this change.

## Ground truth (production API)

- Totals by tab: bulk **1240**, specialty **1063**, forwarding **15** (2318 rows).
- Totals by status: dispatched **1669**, delivered **581**, results_in **60**, requested **8**.
- `/stats.awaiting_results` = **581** (delivered, no result, Specialty+Bulk).
- `/search?q=sucafina nv` → **185** matching rows (API itself caps a page at 100).
- `/search?q=SL-7346` → **2** rows share that ref.
- `/clients?q=beyers` → **0** clients, though `/search?q=beyers` → 23 samples reference it.

## Results (pre-fix)

| # | Question | Agent answer | Truth | Verdict |
|---|----------|--------------|-------|---------|
| 1 | How many samples are dispatched? | **1,669** | 1669 | ✅ PASS — surfaces the true `total` |
| 2 | List all samples to Sucafina NV | "185 total", shows a snapshot, offers **"Show full list"** | 185 | ⚠️ PARTIAL — right count, but offers a list it can't deliver |
| 3 | Show the full list of all 185 | 25 rows, then *"only surfaces the top 25 per query (no pagination parameter available to me). I can't pull all 185 rows."* | 185 | ❌ FAIL — listing cap |
| 4 | Status of SL-7346 | One record (AB Swara, dispatched) | 2 rows | ⚠️ PARTIAL — silently answers one of two matches |
| 5 | Find client Beyers | "No match in the client book" | clients=0 | ✅ tool correct / ⚠️ **data gap** (client absent though 23 samples reference it) |
| 6 | How many samples are awaiting results? | **100** | 581 | ❌ FAIL — **confidently wrong**, undercounts by 481 |

## Root causes (agent-side, `src/skills/tools/`)

1. **`SearchSamplesTool`** — hardcoded `pageSize=25`, no `page` input → can only ever return 25 rows (#2, #3). Reports the true `total`, so counts (#1) are right.
2. **`ListAwaitingResultsTool`** — fetches `status=delivered&pageSize=100`, filters client-side, then reports `total = items.length` → the count of the filtered *first 100*, **not** the true DB total (#6). Also slices display to 25.
3. **`FindOpenSamplesTool`** — `pageSize=50`, no paging. Not exercised now (only 8 open) but the same latent cap.
4. **`GetSampleStatusTool`** — `pageSize=1` → no disambiguation when a ref/text matches several rows (#4).
5. **`FindClientTool`** — no `pageSize`, reports no count → truncation invisible (not hit here).

## Backend cause (`api/src/routes/search.ts`)

`GET /search` accepts only `pageSize` (clamped ≤100) with **no `page`/`offset`** — so even a fixed agent tool can't reach rows past 100. `total` is already a true window-function count. The per-table endpoints and `/clients` already paginate; `/search` was the gap.

## Fix (this change)

- **Backend:** add `page`/`offset` to `GET /search`; return `{data,total,page,pageSize}` (mirrors `api/src/lib/list.ts`).
- **Agent tools:** `pageSize=100` + optional `page`, return `{total,page,pageSize,returned,hasMore}`; `ListAwaitingResults` reports the **true** count; `FindClient` returns a count. Behavior for big sets: **report the true total, show the first page, offer to narrow/continue** (never auto-dump).
- **Data gap (#5):** Beyers not in the client book — flagged to the team; not a code fix.

## Re-QA (post-fix, verified against live prod data)

The fixed tools call the current prod API, so their new behaviour was verified against live
data **without deploying** (replicating each tool's exact API calls + computations). Backend
page-2 support is proven by the api unit tests (`page=1` vs `page=2` return different rows).

| Check | Result |
|-------|--------|
| `search_samples("sucafina nv")` → total **185**, returned **100**, `has_more` **true** | ✅ |
| `search_samples("beyers")` → `has_more` **false** (23 ≤ 100) | ✅ |
| `search_samples(status=dispatched)` → total **1669** | ✅ |
| `find_open_samples()` → total **8**, `has_more` **false** | ✅ |
| **`list_awaiting_results()` → total 581** (was **100**), `has_more` **true** | ✅ fixed |
| `find_client("beyers")` → total **0** (surfaced, so the agent offers to add) | ✅ |

Evidence: `npm test` (dashboard-v2) 50/50; `npm test` (api) 89/89 incl. new `/search` pagination
tests; agent `lua compile` 21 primitives; tool-logic verification 9/9 against prod.

### Still requires deployment to land end-to-end
- **Agent push/deploy** — so the live agent uses the fixed tools (report true totals, offer to
  narrow/continue, correct awaiting-results count).
- **API redeploy (VPS)** — so `GET /search` honours `page`, letting the agent walk past row 100
  (rows 101–185 for "sucafina nv"). Until then the agent correctly reports the true total and
  the first 100, and says there are more.

### Not a code fix
- **#5 Beyers not in the client book** — `find_client` works correctly; the *data* is missing
  (23 samples reference "beyers" but no client record exists). Flagged to the team to add.
- **#4 SL-7346 disambiguation** — `get_sample_status` still resolves the single first match
  (`pageSize=1`); left as-is this round (out of the agreed scope), noted for a follow-up.

---

## Column coverage — "does the agent get every field, all the derivative info?"

Traced all four layers: **Excel → DB → API → agent tools.**

- **Excel → DB: complete.** Source `docs/Sample Chaser2025-2026.xlsx` (4 sheets). Seed stores every source
  column **verbatim** (16 specialty / 19 bulk / 10 forwarding + client name + 4 contact fields) AND keeps
  the derived companions (`courier`+`courier_norm`, `qty`+`qty_grams`, `moisture`+`moisture_pct`,
  `date`+`date_on`, `result`+`result_norm`, `sample_type`+`sample_type_norm`). `seed-report.json`: dropped = 0.
  Only unrecoverable: 3 stray cells in a blank-header column of Client Details.
- **The gap was the agent's tools**, not the data. Search returned only 11 fields; there was no way to reach
  grade/moisture/ICO/sender/origin/id-number/etc. in a list, **no** way to read a client's address/contacts/
  orders, and the stats breakdowns were unused.

### What changed

| Gap | Fix |
|-----|-----|
| List/search too thin | `search_samples` now also returns `country`, `sample_type`, `qty_grams`, and filters by `sample_type`/`country`; `find_open_samples` & `list_awaiting_results` no longer drop courier/awb/date. *(Needs API redeploy — same as pagination.)* |
| No book-specific fields | **New `get_samples_by_book`** — full rows from one book (every column, incl. grade/outturn/moisture/ICO/sender/origin/id_number/comments/crop_year/sample_type + chaser follow-up), with the book's filters. Uses existing per-table endpoints — live now. |
| Client detail unreachable | **New `get_client`** — address, contacts, account owner, order history via `/clients/:id`. Closes the gap the client-book skill already assumed. `find_client` now also returns `contact_count` + `latest_order_date`. Live now. |
| Stats unused | **New `get_sample_stats`** — counts/breakdowns by status/tab/type/country/courier/result, aging, dispatched-this-week, volume-over-time. Live now. |
| Raw dumps | Persona + skills now instruct compact, labelled presentation (line-per-record, address blocks), not JSON. |

Per-record, `get_sample_status` was already the full-row escape hatch. Net: the agent can now reach **every
stored column** — full detail per record (`get_sample_status`), per book (`get_samples_by_book`), per client
(`get_client`), plus aggregates (`get_sample_stats`) — presented cleanly.

**Verification (no deploy):** agent `lua compile` 24 primitives (17 tools); api **102/102** (incl. new search
field/filter tests); live-prod tool-logic **6/7** (the 7th — widened search fields — awaits the API redeploy).

**Still requires the API redeploy** for the widened `/search` projection + `sample_type`/`country` filters to
appear on prod. The three new tools (`get_client`, `get_sample_stats`, `get_samples_by_book`) work against the
current prod API and only need the **agent** deployed.
