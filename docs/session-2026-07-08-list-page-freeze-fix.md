# Session recap — 2026-07-08: list-page freeze fixed, filters + sorting re-enabled

**Status:** ✅ Done. Committed `11aebb7`, pushed to `main` (Vercel auto-deploys).
**Component:** `dashboard-v2` (Vite + React 18).
**Full incident writeup:** `docs/incident-2026-07-08-list-page-freeze.md` (§0 = resolution).

---

## What you asked for

> "I need to add filters/sortings in our tabs. WHY THE FUCK WERE EARLIER ONES NOT WORKING. Make proper ones this time."

So two things: (1) explain why the earlier filters/sorting didn't work, and (2) make them work properly.

---

## The short answer to "why weren't they working"

**The filter/sort logic was never broken.** They worked. The problem was that *using* them
**froze the whole browser tab**, so a previous session ripped the feature out as a stopgap
and never put it back. That's why it looked like "filters don't work" — the feature was
just... gone.

The real bug was one layer underneath the filters, in how the table reloads data.

---

## How the freeze actually worked

Every time you touched a filter or clicked a column to sort, this chain fired:

1. The filter/sort change updates the **query key** for the records request.
2. `useRecords` had **no `keepPreviousData`**, so React Query threw away the current data
   and flipped to a loading state — `rows` became empty.
3. `RecordTable` renders a **virtualized** table body. With `rows` empty it tore out all the
   virtualized rows (row count **N → 0**) and dropped in skeleton placeholders, then swapped
   back to real rows (**0 → N**) when the response landed a few ms later.
4. `@tanstack/react-virtual` watches the scroll container with a **ResizeObserver**. That
   count/height collapsing to ~0 and re-expanding sent it into a **synchronous layout storm
   inside the browser's rendering engine (Blink)** — which wedges the main thread. The tab
   goes dead until you reload.

### Why it was so confusing to diagnose

- **"CPU idle" during the freeze** — because the busy work is native browser *layout*, not
  JS. The JS profiler only samples JS, so it reported idle while the tab was actually pinned.
- **Sorting froze too, with no popover involved** — that was the key tell. Filtering and
  sorting share exactly one code path (the query-key change → table re-render), so the cause
  had to be there, not in the filter dropdown. An earlier session had already rewritten the
  filter popover *without* Radix and confirmed it still froze — correctly ruling the popover
  out.
- **Only a real mouse click reproduced it** — synthetic/programmatic clicks bypass the
  browser's hit-testing and fire handlers directly, so they never triggered the wedge.

---

## Why the earlier attempt "didn't fix it"

A previous session **localized** the cause (they even wrote down `keepPreviousData` as the
likely fix) but **never confirmed it**, and shipped a stopgap for the deploy instead:

- `<FilterBar>` unmounted from all four list pages.
- `RecordTable` got a `sortable` prop, and pages passed `sortable={false}`.

So the fix was a good guess left unverified, and the feature stayed removed. That's the gap
this session closed.

---

## What I did this session

1. **Reproduced it for real.** Brought up the full stack locally (Postgres + API on `:4000`
   + Vite on `:5174`), temporarily re-enabled the filter bar, and clicked Status →
   "dispatched" with a real pointer click. It hung and wedged the page exactly as reported —
   even out-of-band debugger calls timed out for 30s while JS sat idle. That combination
   (main thread wedged + JS profiler idle) **proved** it's a native layout wedge and ruled
   out the other theories (stuck `pointer-events`, an overlay, a leaked pointer capture — all
   of which would have left the page's event loop alive).
2. **Fixed the root cause** — one line in `dashboard-v2/src/lib/query.ts`:

   ```ts
   export function useRecords(endpoint: string, q: ListQuery) {
     const qs = buildListParams(q).toString();
     return useQuery({
       queryKey: [endpoint, 'list', qs],
       queryFn: () => api<ListResult<Record<string, unknown>>>(`${endpoint}?${qs}`),
       placeholderData: keepPreviousData, // <-- the fix
     });
   }
   ```

   The previous page's rows **stay mounted** while the next set loads, so the query never
   flips to a loading/empty state on interaction, the skeleton swap never happens, the
   virtualizer's row count and scroll height stay stable, and there's no re-measure storm.
   (The list just dims slightly via the existing `isFetching` opacity while refetching.)
3. **Re-verified with real clicks** — no freeze anywhere:
   - **Samples:** Status → dispatched filtered **1063 → 692**; Ref-column sort applied on top;
     both together — instant. Diagnostics printed the clean verdict
     `state after filter:patch (+400ms) — no obvious block detected`.
   - **Bulk:** Status → delivered — instant.
   - **Clients:** typed "coffee" in search, **270 → 77** over 6 rapid keystrokes — instant.
   - **Forwarding:** renders with its filter bar.
4. **Re-enabled filters + sorting** on all four pages (reverted the stopgap: FilterBar
   remounted, filters wired, `sortable={false}` removed, Clients' `justify-between` layout
   restored).
5. **Green across the board:** `tsc -b && vite build` ✅ · `vitest` **46/46** ✅.

---

## Bonus finding (worth remembering)

The `freeze-diag.ts` instrumentation that was shipped to catch this **can't actually
self-report *this* class of freeze**: its auto-probe is a `setTimeout` and its watchers are
`MutationObserver` callbacks — neither can run while the main thread is synchronously wedged,
so its console stays silent during the freeze (the silence is itself the tell). It only
reports freezes that leave the event loop alive. The reliable signal for a native/layout
wedge is: **"a real click hangs *and* debugger calls hang, while the JS profiler shows
idle."** Noted in the incident doc for next time.

---

## Files changed

| File | Change |
|---|---|
| `dashboard-v2/src/lib/query.ts` | `placeholderData: keepPreviousData` on `useRecords` (the fix) |
| `dashboard-v2/src/pages/SamplesPage.tsx` | Re-enabled FilterBar + sorting |
| `dashboard-v2/src/pages/BulkPage.tsx` | Re-enabled FilterBar + sorting |
| `dashboard-v2/src/pages/ForwardingPage.tsx` | Re-enabled FilterBar + sorting |
| `dashboard-v2/src/pages/ClientsPage.tsx` | Re-enabled FilterBar + sorting, restored layout |
| `docs/incident-2026-07-08-list-page-freeze.md` | Marked RESOLVED, recorded confirmation + finding |

---

## Open follow-ups (not blocking)

- **Enum filter options are hardcoded** in the tab configs (statuses, couriers, etc.). They
  work, but they can drift from actual DB values. Small follow-up: drive them off the API.
- **Local dev servers are still running** (API `:4000`, Vite `:5174`, Postgres container) —
  say the word and I'll stop them.
- **Prod verification:** once the Vercel deploy lands, paste me the URL and I'll re-run the
  real-click filter/sort check against production.
</content>
