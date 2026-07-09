# Session 2026-07-08 — Agent UX: in-app jump, guided intake, fetch completeness

Three improvements to the Sucafina sample-management agent + CRM, driven by real UX gaps.
Branch: `feat/agent-inapp-jump-guided-intake-fetch` (`11baf8f`) — committed, **not pushed / not deployed**.

## The three asks

1. **No new link when already in the CRM.** Every agent write returned an absolute deep-link the
   user had to click like an external URL. Wanted: highlight the changed row and click it to jump
   straight there — in-app.
2. **Hand-hold sample creation.** A first-timer should be able to log a sample *with complete
   information* — explicit step-by-step guidance with spelled-out choices, never a half-empty record.
3. **Test whether the agent can "fetch everything."** And fix it if not.

## Decisions (agreed up front)

- Chat stays on its own `/assistant` tab; clicking a result does an **in-app jump** (not a docked/
  floating chat).
- Guided flow = **explicit numbered steps + progress + pick-lists**, optimised for completeness.
- Fetch fix goes **all the way** (backend `/search` pagination + agent tools + redeploy); large
  result sets → **report the true total + first page + offer to narrow/continue** (never auto-dump).
- Sequence: build #1 → #2, then #3 (QA to prove the gap → fix → re-QA).

---

## Part 1 — In-app jump (no external link)

**Mechanism:** the chat iframe uses `srcDoc`, so it's same-origin with the app (no `sandbox`, no CSP
anywhere in the repo). A click inside the chat can be intercepted and handed to the SPA router —
no new tab, no reload. The row-flash + "✨ Just created/updated" banner already existed (`lib/
highlight.ts`, `HighlightBanner`, `RecordTable`, `DetailDrawer`); we only changed what drives it.

**Changes:**
- `dashboard-v2/src/components/LuaChat.tsx` — `buildSrcDoc()` bakes in the parent origin and installs
  a **capture-phase click relay**: on an anchor whose path matches `^/(samples|bulk|forwarding|
  clients)/…` and carries `?hl=`, it `preventDefault()`s and `postMessage`s `{source:'lua-chat',
  type:'open-record', path}` to the parent. (Matches by path, not origin, so it also works in dev
  where the agent returns the prod absolute URL.)
- `dashboard-v2/src/lib/useLuaChatBridge.ts` *(new)* — listens for that message (origin-checked,
  shape-checked, in-app-path-only) and calls `navigate(path)`.
- `dashboard-v2/src/App.tsx` — mounts `useLuaChatBridge()` in the app shell (inside `BrowserRouter`,
  survives route changes; the chat/sender only lives on `/assistant`).
- `dashboard-v2/src/components/RecordTable.tsx` — **scroll-into-view** for the flashed row
  (`rowVirtualizer.scrollToIndex`), so a match below the fold isn't flashed invisibly. *(This edit
  landed in HEAD via the concurrent sort-indicator commit, not in `11baf8f`.)*

**Net behaviour:** click a record link in chat → the app navigates in place, scrolls the row into
view, flashes it, and opens its drawer with the banner. External deep-links (Teams/email) still
full-load as before.

**Tests:** `useLuaChatBridge.test.tsx` — navigates on a valid message; rejects wrong-origin /
wrong-shape / absolute-URL. Typecheck clean; dashboard-v2 **50/50**.

---

## Part 2 — Guided, complete sample creation (agent-side only)

No API/schema change — the create tools already hard-require each book's fields.

**Changes:**
- `src/skills/sample-intake.skill.ts` — new **GUIDED INTAKE** block: when input is sparse or the
  user asks for help, the agent drives an explicit flow — announce + number the steps ("step 1 of
  N"), offer choices (Book: Specialty/Bulk/Forwarding; sample type; grade AA/AB/PB/…), ask required
  fields one at a time, **speak defaults aloud** (qty 200/300/1000g), then echo the complete row +
  confirm before writing. Never writes an incomplete record.
- `src/persona.ts` — "meet people where they are": hand-hold newcomers with numbered steps +
  pick-lists; keep the one-shot **fast path** for fluent users.

**Verified:** `lua compile` clean (21 primitives). Live conversational check is pending deploy.

---

## Part 3 — Fetch completeness ("can it fetch everything?")

### Answer: no (pre-fix), now fixed.

**QA (production agent + API), full write-up in `docs/session-2026-07-08-fetch-qa.md`:**

| Question | Agent (pre-fix) | Truth | Verdict |
|----------|-----------------|-------|---------|
| How many dispatched? | 1,669 | 1669 | ✅ surfaces true total |
| List all to Sucafina NV | "185 total" + snapshot, offers full list | 185 | ⚠️ promises a list it can't deliver |
| Show full list of 185 | 25 rows, "capped at top 25, no pagination…" | 185 | ❌ listing cap |
| Status of SL-7346 | one record | 2 | ⚠️ silent single-match |
| Find client Beyers | "no match in client book" | 0 clients | ✅ tool ok / data gap |
| **How many awaiting results?** | **100** | **581** | ❌ confidently wrong |

**Root causes:** `search_samples` `pageSize=25` + no paging; `list_awaiting_results` reported
`total = items.length` (the filtered first 100, not the DB count); `GET /search` had **no
pagination at all** (max 100, no `page`/`offset`).

**Fixes:**
- `api/src/routes/search.ts` — add `page`/`offset`, return `{data,total,page,pageSize}` (mirrors
  `api/src/lib/list.ts`). Test in `api/test/search.test.ts`.
- `src/skills/tools/SearchSamplesTool.ts`, `FindOpenSamplesTool.ts` — `pageSize` 25/50 → **100**,
  add `page`, return `total` + `page` + `returned` + `has_more`.
- `src/skills/tools/ListAwaitingResultsTool.ts` — true count from `/stats.awaiting_results` (defined
  server-side as exactly delivered + no result + not forwarding), first page of examples + `has_more`.
- `src/skills/tools/FindClientTool.ts` — `pageSize=100`, surface `total` (so `total:0` reads as
  "not in the book yet — offer to add").
- `src/skills/status-and-tracking.skill.ts`, `results-capture.skill.ts` — report true totals; when
  `has_more`, offer to narrow/continue; never call a partial page "the full list."

**Re-QA (verified against live prod, no deploy needed):** search "sucafina nv" → total 185 /
returned 100 / `has_more` true; awaiting results → **581** (was 100); open → 8 / no more; find_client
beyers → 0. **9/9 checks pass.** Backend page-2 proven by the api unit tests. api **99/99**.

---

## Verification summary

| Area | Result |
|------|--------|
| dashboard-v2 typecheck | clean |
| dashboard-v2 tests | 50/50 (incl. 3 new bridge tests) |
| api tests | 99/99 (incl. new `/search` pagination + concurrent `stats-filter`, migration 003) |
| agent `lua compile` | 21 primitives, in sync |
| fetch tool logic vs live prod | 9/9 |

All green **with the concurrent backend/dashboard work present** (migration 003, `stats.ts`,
`FilterBar`, `dashboard-filters`, etc.) — my changes and those coexist.

## Committed vs left alone

- **Committed** (`11baf8f`, 15 files): the Part 1 bridge (LuaChat/App/hook + test), Part 2 skill +
  persona, Part 3 `search.ts` + test + 4 tools + 2 skills, and the QA report.
- **Left uncommitted** (your in-flight work): `stats.ts`, `stats-filter.test.ts`, migration 003,
  `FilterBar.tsx`, `query.ts`, `DashboardPage.tsx`, `dashboard-filters.ts`, `api/.gitignore`, loose
  docs/screenshots.

## Remaining — deploy (3 independent steps, gated)

1. **FE** — merge branch → `main` + `git push origin main` (Vercel auto-deploys). Enables the in-app
   jump. *(Only step needed for the Part 1 UX.)*
2. **Agent** — `/lua-deploy` — brings guided intake + fixed fetch tools live.
3. **API** — redeploy to the Contabo VPS — activates `/search` pagination (walk past row 100).

## Known follow-ups (not code bugs)

- **Beyers absent from the client book** though 23 samples reference it — data entry, flagged.
- **`SL-7346` has 2 records**; `get_sample_status` still resolves the first match (`pageSize=1`) —
  out of scope this round, noted for later.
