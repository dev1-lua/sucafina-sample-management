# How sample "Status" is decided (Requested / Dispatched / Delivered / …)

**TL;DR:** The Sample Chaser spreadsheet has **no Status column**. Status is
*computed* by us from other cells in each row. A row shows **Delivered**
whenever its **Delivery date** cell is filled in (and no Result yet) — nobody
ever typed "delivered" anywhere.

---

## 1. The source of confusion

The workbook `Sample Chaser2025-2026 - Sample Chaser.xlsx` is a **dispatch +
result log**. Each row is one sample sent to one recipient. Its columns are
things like:

> Date · Ref · Name · Grade · Bags · AWB# · Courier · Qty · **Delivery date** · **Result** · Comments

There is **no "Status" field in the sheet**. So if you see a sample marked
`Delivered` (or `Dispatched`, `Requested`, etc.), that label was **derived by
our system at import time**, not read from a cell.

---

## 2. Where the derivation lives

Two places implement the same rule and must agree:

| Purpose | File |
|---|---|
| Import / seed from the spreadsheet | `scripts/seed/run.ts` → `inferStatus()` (~line 116) |
| Re-derive on the database | `api/migrations/004_chaser_followup_and_freeform.sql` (~line 77) |

---

## 3. The decision ladder (highest signal wins)

For **Specialty** and **Bulk** samples, each row is checked top-down — the
**first** matching rule wins:

| # | If this cell is filled… | …status becomes | Spreadsheet column |
|---|---|---|---|
| 1 | **Result** (Approved / Rejected) | `results_in` | Specialty **M** · Bulk **P** |
| 2 | **Delivery date** | **`delivered`** | Specialty **L** · Bulk **O** |
| 3 | **AWB#** *or* **Courier** | `dispatched` | Specialty **I/J** · Bulk **J/K** |
| 4 | *(none of the above)* | `requested` | — |

Two rules sit outside the ladder:

- **`cancelled`** is never auto-derived — it is set manually only.
- **Soft-deleted** rows (`deleted_at` set) are skipped entirely.

### The exact logic

```
if   Result is present        → results_in
elif Delivery date is present → delivered
elif AWB# or Courier present  → dispatched
else                          → requested
```

```sql
-- api/migrations/004_chaser_followup_and_freeform.sql
UPDATE specialty_samples SET status = (CASE
    WHEN result_norm IS NOT NULL                                    THEN 'results_in'
    WHEN delivery_on IS NOT NULL                                    THEN 'delivered'
    WHEN (awb IS NOT NULL AND awb <> '') OR courier_norm IS NOT NULL THEN 'dispatched'
    ELSE 'requested'
  END)::sample_status_t
  WHERE deleted_at IS NULL AND status <> 'cancelled';
```

**Forwarding** samples have no Delivery-date / Result columns (reduced
lifecycle), so they can only ever be `requested` → `dispatched`, based on
AWB / Courier.

---

## 4. So why is a given row "Delivered"?

Because that row has a value in its **Delivery date** cell (Specialty col **L**,
Bulk col **O**) **but no Result yet**.

- That single cell is the entire trigger.
- The moment a **Result** is also logged, the row jumps up to `results_in`.
- If a row looks wrongly "Delivered," check whether its Delivery-date cell is
  accidentally populated — that's what flipped it.

---

## 5. What each dashboard status means

| Status | Meaning | Trigger |
|---|---|---|
| **Requested** | Logged, nothing shipped yet | No AWB, no courier |
| **Dispatched** | On its way (shipped, arrival not confirmed). Shown with the hint *"Delivery not confirmed"* — the honest relabel of the old "in transit" | Has AWB# or Courier |
| **Delivered** | Arrival confirmed, not yet cupped | Delivery date present, no Result |
| **Results in** | Cupping verdict logged (Approved / Rejected). Terminal | Result present |
| **Cancelled** | Manually cancelled | Set by hand only |

The three **Chaser** follow-up buckets sit in the gaps between these:

1. **Not dispatched** — stuck at `requested` past due.
2. **Dispatched, no delivery confirmation** — `dispatched` for > 5 days.
3. **Delivered, awaiting results** — `delivered` for > 7 days.

---

## 6. Important caveat: the Result column is mostly empty

Per the data dictionary (§5.5), Specialty's **Result** column is *essentially
unused* — most specialty samples never get a logged verdict (the outcome lived
in email/chat and never made it into the sheet).

Consequence: many samples that were actually cupped will sit forever at
`delivered` (or `dispatched`) because the ladder never sees a Result to promote
them to `results_in`. The status reflects **what's recorded in the sheet**, not
necessarily the real-world state of the sample.

---

## 7. Key takeaways

- **Status is derived, never stored** in the source spreadsheet.
- **Delivered = a Delivery-date cell is filled** (and no Result).
- The ladder is *highest-signal-wins*: Result > Delivery date > AWB/Courier > nothing.
- `cancelled` and soft-deletes are the only exceptions.
- A missing/empty Result column means samples can get "stuck" at `delivered`
  even after they were cupped — a data-entry gap, not a bug in the logic.

---

*Related: `docs/data-dictionary.md` (column layout & normalization rules),
`api/src/lib/reminders.ts` (how the Chaser buckets age off dates).*
