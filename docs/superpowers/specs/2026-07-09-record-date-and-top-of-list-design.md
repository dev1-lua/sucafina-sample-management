# Design — New-record date + latest-record-at-top (Problems A & B)

Date: 2026-07-09
Scope: Handover Problems **A** (records have no date; agent has no date awareness) and
**B** (a newly created record should appear at the top of the list, not get lost).

## Problem statement

1. **A** — The three create handlers (`specialty-samples`, `bulk-samples`, `forwarding-samples`)
   set neither the verbatim `date` text column nor the typed `date_on` date column. New rows have a
   blank Date and a NULL `date_on`. The agent also states no date in its confirmation.
2. **B** — The list sorts by `date_on DESC NULLS LAST` with an `id ASC` tiebreak. Because `id` is a
   random `gen_random_uuid()`, and because A leaves `date_on` NULL, new rows sink to the bottom/last
   page and "get lost." The deep-link flash/scroll (Part 1, prior session) only fires when the row is
   on the currently-loaded page, so a bottom row silently no-ops.

## Verified facts (from the code, 2026-07-09)

- Tables have **both** `date text` (verbatim, what the dashboard "Date" column displays) and
  `date_on date` (typed, what the list sorts by). FE column: `{ key: 'date', header: 'Date',
  sortKey: 'date_on' }` (`dashboard-v2/src/tabs/{specialty,bulk,forwarding}.tsx`).
- Seeded `date` text is ISO `YYYY-MM-DD`, identical to `date_on`. New rows must match this.
- `created_at timestamptz NOT NULL DEFAULT now()` exists on all three tables.
- `buildList` (`api/src/lib/list.ts:56-61`) is used **only** by the three sample routes. `clients.ts`
  uses its own inline query (`c.id ASC` tiebreak) and is unaffected.
- The same POST endpoints serve **both** the agent's create tools and the dashboard "Add" form.
- No test asserts the current `id ASC` tiebreak; the one ordering assertion
  (`specialty-samples.test.ts:33`) only ever has a single matching row.

## Design

### A. Default the date server-side (Nairobi time), with an optional override

In each of the three `POST /` handlers:

- Extend `createSchema` with an optional ISO date:
  `date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish()`.
  This is the future MS-Teams seam. The agent tools do **not** send it yet, so it is always absent →
  server defaults to Nairobi-today.
- Add both columns to the INSERT, defaulting to Nairobi's current date when `date` is absent. Using a
  single positional param `$N = body.date ?? null`, referenced twice:
  - `date` (text): `COALESCE($N, to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD'))`
  - `date_on` (date): `COALESCE($N::date, (now() AT TIME ZONE 'Africa/Nairobi')::date)`

`now() AT TIME ZONE 'Africa/Nairobi'` is timezone-correct regardless of the DB server's TZ setting
(unlike `CURRENT_DATE`). It requires no date knowledge from the model.

Rationale for server-side: covers the agent tools AND the dashboard Add form in one place; robust;
consistent with the existing `delivery_on = ... CURRENT_DATE` precedent in the PATCH handlers.

### B. Make the newest-created row sort first

Change the `buildList` tiebreak (`api/src/lib/list.ts:58`) from:

```
ORDER BY ${sort} ${order} NULLS LAST, id ASC
```

to:

```
ORDER BY ${sort} ${order} NULLS LAST, created_at DESC, id ASC
```

With A giving new rows today's `date_on`, they float to the top of the default `date_on DESC` list;
the `created_at DESC` tiebreak guarantees the newest-created row is #1 even when several rows share
today's date. `id ASC` remains as a final deterministic tiebreak. Contained to the three sample tables
(the only `buildList` callers, all of which have `created_at`).

No primary-sort change — users still see business-date order; future-dated samples keep their place.

**Why `created_at` as a tiebreak, not the primary sort, and not a new/UUIDv7 id.**
`created_at` is already the hidden, microsecond-precise per-record creation timestamp we want to order
by — no new column or time-ordered id is needed. It is used as the *tiebreak* (under `date_on`), not
the primary sort, because the ~thousands of imported rows all share (roughly) the seed-import
`created_at`; making it primary would clump the imported history together and bury the real
business-date ordering users recognize. As a tiebreak it only acts when `date_on` is equal — exactly
the "several samples logged today" case. A time-ordered UUID (UUIDv7) would only help new-vs-new rows
(existing rows keep random v4 ids), needs PG18 or an extension (we run PG16), and buys nothing over
`created_at`.

### Agent surface

- The three create tools (`CreateSpecialtySampleTool`, `CreateBulkSampleTool`,
  `CreateForwardingSampleTool`) echo the returned `date` (ISO) in their result object.
- `src/persona.ts` write-result rule states the date in the confirmation, e.g.
  "Logged today (2026-07-09)". No date-computation logic in the persona — it reads back the value the
  API returned.

### No FE change required

The dashboard already displays `date` and sorts by `date_on`, and React Query refetches on
navigation/focus. Once a new row carries today's date + newest `created_at`, it renders at the top of
page 1, so the existing deep-link flash/scroll works. (If end-to-end QA shows the FE overriding the
default sort on load, revisit — but current reading says no change is needed.)

## Testing

- **API (`api`, vitest):**
  - specialty/bulk/forwarding create with no `date` → response `date_on` and `date` both equal Nairobi
    today (`new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })`), both ISO.
  - create with an explicit `date` override → both columns reflect it.
  - list default sort: create two rows the same (auto) day → `data[0]` is the **second-created** row
    (newest-first tiebreak).
- **Existing suites** must stay green: `cd api && npx vitest run` (102 baseline),
  `cd dashboard-v2 && npm run typecheck && npm test`.
- **Agent:** `lua compile --ci` clean; a create tool result includes `date`.

## Out of scope

Problems C & D (guided intake full field-set + jargon explainer) — next, per the agreed order.
Deploys (API redeploy, `/lua-deploy`, FE push) are gated on explicit user request.

## Deploy note

A is a **backend change → needs an API redeploy** to reach prod. B ships with the same redeploy.
The persona/tool echo ships via `/lua-deploy`. Nothing deploys without explicit ask.
