# Round 11 spec — Send ID, QC-editable ref, Clients view (28 Sep call)

Source: 28 Sep call with Ivo, Harriet, Daniel (transcript-neww.txt). Three asks, one rule.

THE RULE (unchanged since 22 Sep, re-confirmed by Ivo + Harriet 28 Sep): a **reference names the coffee**
(SL-7307 = one stock lot; TYPE-973 = one outturn+grade). The same coffee sent to five clients keeps ONE
reference. A different coffee needs a different reference. References are owned by the Quality team.

What confused the team: the ref was doubling as the row identifier, and the Coffees view (group by ref)
reads like "one ref → three clients" with no explanation. Fixes below.

## 1. Send ID — `send_id`, format `SS-<n>` (unpadded, like CN-1012 / SL-7459)

- New column `send_id text` on `specialty_samples`, `bulk_samples`, `forwarding_samples`. NOT on legacy `samples`.
- Minted by the DB: `ref_counters` row `('SS', 1000)`; SQL function `next_send_id()` doing the
  `UPDATE ref_counters SET next_val = next_val + 1 WHERE prefix='SS' RETURNING next_val - 1` pattern;
  a BEFORE INSERT trigger on each of the three tables sets `NEW.send_id` when NULL. Rides the insert's
  transaction; covers every insert path (routes, drawPss, importer, seed, tests).
- Immutable: never in a PATCH schema, never released on delete (do NOT copy `releaseRefIfLatest`).
- Unique index per table on `send_id`.
- Backfill in migration 025: every row (live AND deleted) of the three tables with `send_id IS NULL`, ordered
  chronologically across tables by `COALESCE(date_on, created_at::date), created_at, id`, block-reserved from
  the counter (pattern: migration 006). Guarded so re-applying is a no-op.
- `all_samples_v` restated in full (from 024:145-185) with TWO new trailing columns: `send_id` (col 35) and
  `option_letter` (col 36; NULL::text for any table that lacks the column). Existing column order untouched.
- `scripts/deploy-api.sh`: append the 025 line; update the header comment. `api/test/schema.test.ts`: add
  `SS` to the expected `ref_counters` rows and the two view columns.

Where the send id must be readable (explicit column lists):
`routes/search.ts` (select + `q` matches `send_id`), `routes/samples-resolve.ts` (select; and when the
`ref` param matches `^SS-\d+$` after `normalize_ref`, match `v.send_id = $1` instead of the ref),
`routes/clients.ts` orders select, `lib/lots.ts` `Send` type + `SENDS_SQL`, `lib/consignments.ts`
`Member` + `memberRows`, `lib/contracts.ts` `drawPss` RETURNING + return type, `lib/digest.ts` select,
each book's `searchColumns` and the `?ref=` list filter (an `SS-\d+` value filters on `send_id`).

## 2. Ref editable by QC (specialty `ref`, bulk `sample_ref`)

`PATCH /specialty-samples/:id` and `PATCH /bulk-samples/:id` accept the ref field. Behaviour:
- normalise with `normalizeRef`; unchanged → no-op.
- run `resolveLot` with the ROW's coffee (specialty: outturn/grade/description; bulk: quality/blend) and the
  new ref, exactly as the create path does:
  - `conflict` (the ref already names a different coffee) → **409** `{ error:'ref_conflict', ref, lot, sends,
    message }` where `message` is plain English, e.g. `TYPE-115 is AB FAQ (3 sends). This row is C FAQ — a
    different coffee. Give it a new ref, or correct the outturn/grade first.` No force flag.
  - otherwise, in ONE transaction: update the ref; if the new ref is a lettered SSKE set `option_letter` from
    it (never "C in the ref, B in the column"); `attachLot` the new ref; `releaseLotIfOrphaned` the old ref;
    events row `type:'ref_changed'`, note `TYPE-116 → TYPE-115`.
- response: the row (`RETURNING *`) + `lot_sends` for the new ref.
- Forwarding: not needed (no lots).

Dashboard drawer: the ref becomes the first editable detail field on Specialty and Commercial. A 409 shows
the server `message` inline (no silent failure). The list + `/lots` queries invalidate as today.

## 3. Clients view (Specialty + Commercial only; Forwarding keeps Sends)

API `GET /client-sends?book=specialty|commercial&q=&page=&pageSize=&sort=&order=`
- Source: live rows of `all_samples_v` with `tab` = `specialty` (book specialty) / `bulk` (book commercial).
- Group key: `COALESCE('id:' || client_id::text, 'name:' || lower(btrim(receiver)))`; rows with an empty
  receiver AND no client_id group under `name:` + `(no client)`.
- Row: `{ key, client_id, client_name, sends, coffees (distinct lot_ref(ref)), open_sends (requested/preparing),
  in_transit (dispatched), delivered_sends, awaiting_results (delivered, no result), approved, rejected,
  last_send_on, last_ref, status_rollup }`. Reuse the `/lots` status rollup semantics.
- `q` matches client_name ILIKE or any of the client's refs / send ids. Sort whitelist: client_name, sends,
  coffees, last_send_on (default desc), open_sends. Paging shape `{data,total,page,pageSize}`, pageSize default 25.

`GET /client-sends/:key?book=` (key URL-encoded by the caller)
- `{ client:{key, client_id, client_name}, sends:[{ tab, id, send_id, ref, option_letter, title, qty_grams,
  date_on, status, courier_norm, awb, result_norm, consignment_number, lot_sends }] }`, `date_on` desc.

Dashboard: `ListView` gains `'clients'` (types.ts, lib/params.ts LIST_VIEWS, SampleListView VIEWS).
`components/ClientsTable.tsx` modelled on `LotsTable.tsx` (RecordTable + expandable, keepPreviousData stays):
- parent columns: Client · Coffees · Sends · Open · Awaiting result · Approved · Rejected · Last send · Status.
- child rows (one line, 32px): Send ID · Date · Ref (+option letter) · Coffee · Qty · Courier/AWB · Status ·
  Result · Order. Click → the sample drawer (`${cfg.path}/${id}`).
- `countLabel` "N client(s)". URL: `?view=clients&client=<name>` → exact `client=<name>` param (not the fuzzy `q`) and that row expanded
  (mirror `?ref=` handling; add `client` to `URL_KEYS`).
- In the Sends table the Receiver (specialty) / Client (bulk) cell links to `?view=clients&client=<name>`
  (same idea as the ×N pill linking to Coffees).

## 4. Explain the views (no more "what am I looking at")

`VIEWS` gets a `hint`, rendered as `text-xs text-muted-foreground` beside the view switch:
- Sends — "One row per sample sent."
- Coffees — "One row per reference. A reference names the coffee, so one coffee sent to several clients sits under one reference."
- Clients — "One row per client. Expand to see every coffee sent to them."
- Orders — "One row per order (CN number): the samples of one request to one client."
Send ID column header carries `title="Unique to this send. The reference names the coffee and is shared by every send of it."`

## 5. Send ID everywhere a row is shown (dashboard)

Sends tables of all three books (first column, narrow, monospace, not defaultHidden); LotsTable child rows
(both grid templates + header); DetailDrawer header (`Send ID SS-1234` under the title); ConsignmentDetailPage
members; ClientOrdersTable; CommandMenu hits; ChaserPage rows if `DigestItem` carries it. FilterBar "Ref"
placeholder → "Ref or Send ID".

## 6. Agent

- Every tool return block that quotes a row adds `send_id: row.send_id` (creates ×3, record_dispatch,
  set_sample_status, set_sample_priority, record_result, search_samples, find_open_samples,
  get_sample_status incl. group sends, list_awaiting_results, get_consignment members, get_client
  recent_orders, get_contract option samples, resolve_lot sends). Typed shapes (`LotSend`, `SampleCandidate`,
  `ResolvedSample` ×2, `GroupSend`) gain `send_id?: string | null`.
- `src/lib/resolve-sample.ts`: an `SS-\d+` value (case-insensitive) resolves via `/samples/resolve?ref=SS-…`
  to exactly one row and NEVER asks "which receiver". `describeSend` → `SS-1234 → TORCH (4 Jun, delivered)`.
- Persona ref rule (src/persona.ts ~L29-31) adds: "Every send also has its own Send ID (SS-1234), unique to
  that row. Quote it on every card and confirmation; accept it wherever a ref is accepted — it never needs a
  receiver to disambiguate." Card header: `**<ref> · <name / quality>** · SS-<n>`. Confirm lines:
  `Logged SS-1234 — SL-7336 (3rd send) → TORCH`.
- Skill text: sample-intake "REFS NAME THE COFFEE" + "CONFIRM BEFORE WRITING"; status-and-tracking;
  dispatch-logging; results-capture; consignments; pss-schedule (one line). Tool descriptions listed in the
  agent map. Notifications/emails quote `ref (SS-1234)` where the row is at hand.
- `npm test` green; `lua compile --ci` still 51 primitives (no new tool).

## Out of scope (say so in the handover)
- The 51 conflict refs from the 23 Sep dry run: QC re-refs them in the drawer (now possible) or via the
  lot-conflicts script. Not automated.
- Data dictionary (Ivo), DHL/FedEx developer-portal keys (Harriet/Daniel), pre-August purge: waiting on Sucafina.
