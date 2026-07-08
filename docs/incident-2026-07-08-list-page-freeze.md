# Incident: List-page freeze on filter/sort interaction

- **Date:** 2026-07-08
- **Component:** `dashboard-v2` (Vite + React 18 frontend)
- **Severity:** High — the four core list pages were unusable once a user touched a filter.
- **Status:** **RESOLVED.** Root cause confirmed by reproduction; permanent fix applied and verified with a real pointer click; filter bar + column sorting re-enabled on all four list pages.
- **Stopgap commit:** `d84f164` — `fix(fe): remove filter bar + disable column sort on list pages to stop page-freeze`
- **Permanent fix:** `placeholderData: keepPreviousData` added to `useRecords` (`dashboard-v2/src/lib/query.ts`); stopgap reverted on `SamplesPage`, `BulkPage`, `ForwardingPage`, `ClientsPage`.
- **Diagnostics commit:** `d84f164` (`dashboard-v2/src/lib/freeze-diag.ts`, installed in `main.tsx`)

---

## 0. Resolution (2026-07-08, confirmed)

The leading hypothesis in §4.2 was **confirmed** and fixed. Sequence of evidence:

1. **Reproduced deterministically.** With the filter bar re-enabled locally (API + Vite +
   real Playwright pointer click), clicking Status → "dispatched" hung at *"performing
   click action"* and wedged the whole page — matching the original report exactly.
2. **The wedge is synchronous and native, not a JS loop and not an async DOM block.**
   While frozen, even out-of-band CDP calls (`Runtime.evaluate`, console read) timed out
   after 30 s, yet the V8 JS sampler shows CPU idle. A blocked main thread + idle *JS*
   sampler ⇒ the busy work is in **Blink layout / ResizeObserver delivery**, not JS. This
   also **rules out** all three async block mechanisms (stuck `pointer-events`, swallowing
   overlay, leaked pointer capture) — every one of those leaves the event loop alive, so
   `freeze-diag`'s 400 ms auto-probe would have fired. It did **not** fire during the
   freeze (see finding below), which is only possible under a synchronous main-thread wedge.
3. **Confirmed shared trigger.** Sorting a column (which mounts **no** popover at all)
   reproduces the identical wedge, so the cause is the query-key change → virtualized
   `<tbody>` swap, not the filter popover.
4. **Fix applied:** `placeholderData: keepPreviousData` on `useRecords`. This keeps the
   previous page's rows mounted across the key change, so the query never flips to
   `isLoading` on interaction, the skeleton swap never happens, the virtualizer's row
   `count` (and the scroll-container height) stay stable, and there is no re-measure storm.
5. **Verified with a real pointer click.** Post-fix, the same click returns instantly;
   Status → "dispatched" filters 1063 → 692 rows; Ref-column sort applies on top; and
   `freeze-diag` now prints `state after filter:patch (+400ms) — no obvious block detected`
   (the clean verdict §7 called for — the probe fires because the main thread is alive).
   Also verified: Bulk filtering, Clients search (270 → 77 over 6 rapid keystrokes),
   Forwarding renders. `tsc -b && vite build` ✅, `vitest run` → 46/46 ✅.

**New finding for future debugging:** `freeze-diag`'s auto-probe is a `setTimeout` and its
overlay/pointer-events watchers are `MutationObserver` microtasks — **none of these can run
during a synchronous main-thread wedge**, so the tool cannot self-report *this* class of
freeze while it is happening (its console stays silent, which is itself a tell). It reports
correctly only for freezes that leave the event loop alive. The decisive signal for a
synchronous/native wedge is "real click hangs **and** CDP calls hang, while the JS profiler
shows idle." If `freeze-diag` ever goes silent during a freeze, suspect a layout/RO wedge,
not one of its three tracked DOM mechanisms.

## 1. Summary

On the list pages (`/samples`, `/bulk`, `/forwarding`, `/clients`), opening a filter
pill and selecting an option (e.g. Status → "dispatched") **froze the entire page**:
nothing was clickable — sidebar, nav, header, table — and only a full reload recovered
it. The same class of freeze was reported for column-header **sorting**.

Because the affected UI is the primary way to work with the tables and a production
deploy was imminent, we shipped a **stopgap**: the filter bar was removed and column
sorting disabled on the list pages, and permanent **diagnostics** were added so the true
cause is captured the next time it reproduces.

## 2. Impact

- **User-facing:** After a single filter click, the page became fully unresponsive to
  mouse input. Keyboard/URL navigation was also effectively blocked; recovery required a
  browser reload. Affected every list page that renders the filter bar.
- **Data integrity:** None. No writes were involved; the freeze is purely a client-side
  interaction state.
- **Backend:** None. The API responded normally throughout (see §4).

## 3. Symptoms (observed)

- Click a filter pill → dropdown opens fine → click a checkbox option → **whole page
  dead**, requires reload.
- **CPU ~100% idle** during the freeze (V8 sampling profiler) → **not** a JS infinite loop.
- **Network healthy**: the filtered request returns `200`/`304` in single-digit ms, CORS
  preflight `204` — confirmed repeatedly. **Not** a backend/data problem.
- **No relevant console errors.**
- Reproduced deterministically with a **real pointer click** (Playwright `browser_click`):
  the click reaches "performing click action" and then **hangs** — the element was
  reported "visible, enabled and stable" a moment earlier.

> ⚠️ **Reproduction caveat:** synthetic/programmatic clicks (`element.click()`,
> evaluate-driven clicks) do **not** reproduce this — they fire handlers directly and
> bypass pointer hit-testing. A **real pointer click** is required.

## 4. Investigation

Method: systematic debugging — reproduce, gather evidence at each layer, form and test a
single hypothesis before any fix.

### 4.1 Hypotheses ruled OUT

| Hypothesis | How it was ruled out |
|---|---|
| Backend too slow / large payload | API returns `200`/`304` in ~1–9 ms; verified in Network panel. |
| JS infinite loop | CPU idle during the freeze. |
| Outdated Radix with the known body-lock leak | Installed versions are already latest: `@radix-ui/react-popover@1.1.19`, `-dropdown-menu@2.1.20`, `-dismissable-layer@1.1.15`, `react-remove-scroll@2.7.2`. The leak (if present) is already patched here. |
| Radix Popover machinery (portal / dismissable-layer / focus-scope) | **The filter Popover was rewritten *without* Radix** (a self-contained dropdown: no portal, no dismissable-layer, no focus-scope, no pointer-capture). **The freeze still reproduced** on the Radix-free version. This is the key finding that redirected the investigation. |

Baseline DOM checks (at rest and with a popover open) were all clean: `document.body`
`pointer-events: auto`, no full-viewport overlay, the checkbox was the top element at its
own center and fully clickable. So **nothing is wrong until the toggle's re-render fires.**

### 4.2 Current leading hypothesis (NOT yet confirmed)

Both **filtering and sorting** trigger the freeze, and their only shared code path is:

```
setFilters/setSort
  → useRecords query key changes
  → React Query returns isLoading (no placeholderData / keepPreviousData)
  → RecordTable swaps the entire virtualized <tbody> to skeleton rows and back
  → @tanstack/react-virtual re-measures (getRect / observeElementRect)
```

An earlier CPU profile showed hot paths in `@tanstack/react-virtual`
`getRect`/`observeElementRect`, consistent with this path. The freeze is therefore most
likely in the **query-change → virtualized-table re-render**, **not** the filter popover.

**This has not been confirmed with a captured `freeze-diag` snapshot yet** (see §7).

## 5. Resolution (what shipped)

Stopgap in commit `d84f164`:

- **Filter bar removed** from `SamplesPage`, `BulkPage`, `ForwardingPage`, `ClientsPage`
  (the `<FilterBar>` is no longer mounted; each page passes `filters={{}}`).
- **Column sorting disabled**: `RecordTable` gained a `sortable?: boolean` prop
  (**defaults to `true`**); the list pages pass `sortable={false}`.
- **Everything is reversible.** `FilterBar.tsx` and its tests are untouched — just not
  mounted. Tables still support: pagination, column show/hide, row-click-to-open, "New",
  and the global ⌘K search.

Verification: `tsc -b && vite build` ✅, `vitest run` → 46/46 ✅.

## 6. Diagnostics added (permanent)

`dashboard-v2/src/lib/freeze-diag.ts`, installed once in `main.tsx`. It watches the only
three ways a page can go dead while the CPU is idle and **auto-names the culprit**:

1. **`pointer-events: none`** stuck on `<html>`/`<body>`/`#root` — a `MutationObserver`
   logs the exact moment it flips, with the offending style/class **and a stack trace**.
2. **A full-viewport overlay** swallowing clicks — reported by an overlay scan.
3. **A leaked pointer capture** (`setPointerCapture` never released) — `setPointerCapture`
   is patched to track live captures.

Also: after any filter change it **auto-probes** interactivity ~400 ms later and logs a
one-line verdict (full JSON snapshot only when blocked). A `filter:patch` breadcrumb marks
the timeline.

**Console entry points (run while the page is stuck):**

```js
window.__freezeDiag()      // full snapshot + verdict, printed as plain-text JSON
window.__freezeCaptures()  // list outstanding pointer captures
```

Set the console level to **Verbose** to see the `[freeze-diag]` breadcrumbs.

## 7. Next step to confirm root cause

Re-enable the filter bar in a local branch and reproduce with the dev server running.
The console will print one of:

- `[freeze-diag] … LIKELY BLOCKED — <mechanism>` + a full snapshot → fix exactly that.
- `[freeze-diag] … no obvious block detected` → rules out all three DOM mechanisms and
  points to the event/React layer (the re-render path in §4.2).

Paste that snapshot into the investigation before attempting the permanent fix.

## 8. Permanent fix — ✅ APPLIED (see §0)

Done exactly as proposed below — a one-liner in the records query (`dashboard-v2/src/lib/query.ts`):

```ts
import { keepPreviousData } from '@tanstack/react-query';
// in useRecords(...)
placeholderData: keepPreviousData,
```

This keeps the previous rows mounted while the new (filtered/sorted) page loads, so the
virtualized `<tbody>` never unmounts/re-measures mid-interaction — which should remove the
trigger entirely. **Must be verified with a real pointer click** (see §3 caveat) and a
clean `freeze-diag` verdict before re-enabling the filter bar and sorting.

## 9. How to re-enable the filter bar / sorting — ✅ DONE

Completed on all four pages (the steps below are kept for the record):

1. On each list page (`SamplesPage`, `BulkPage`, `ForwardingPage`, `ClientsPage`):
   restore the `filters` `useState` and the `<FilterBar defs={cfg.filters} value={filters}
   onChange={setFilters} />` line, change `filters={{}}` back to `filters={filters}`, and
   remove `sortable={false}`.
2. `ClientsPage` also needs its `flex … justify-between` wrapper restored.
3. `git show d84f164` shows the exact diff to reverse.

## 10. Lessons / notes for future debugging

- **Real pointer clicks only.** Synthetic clicks bypass hit-testing and will falsely
  "pass". This cost time before it was noted.
- **"CPU idle + page dead + reload fixes it"** ⇒ almost always one of: stuck
  `pointer-events`, a swallowing overlay, or a leaked pointer capture. `freeze-diag` now
  checks all three automatically.
- **Rewriting a suspect to rule it out** (here, the Radix Popover) was decisive — it
  proved the popover was innocent and redirected the search to the shared re-render path.
- Prefer **baking in durable, plain-text diagnostics** over live DevTools archaeology when
  a bug is intermittent or hard to capture interactively.
