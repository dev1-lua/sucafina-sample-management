-- 004_chaser_followup_and_freeform.sql
--
-- Client feedback on the Sample Chaser (items #8, #9, #10):
--   (a) #9  Add free-form chaser follow-up columns to all three sample tables,
--           plus `country` on specialty for parity (bulk already has it,
--           forwarding uses `origin`). No source data exists for these — they
--           are user-maintained tracking fields, so plain nullable text that can
--           hold "Yes"/"No", a date, or free text (the operator's choice).
--   (b) #10 Convert `courier_norm` (all 3 tables) and `sample_type_norm`
--           (specialty + bulk) from their Postgres enums to text, so the
--           edit UI's "Other → type a custom value" actually persists. status
--           and result stay controlled enums (they drive badges/filters/stats).
--   (c) #8  Re-derive existing rows' status from source signals (the source
--           workbook has no status column; import over-assigned "dispatched").
--
-- Written to apply once to the live/seeded DB (like 003), and to be re-run-safe
-- (IF [NOT] EXISTS, idempotent UPDATE). The courier_t / sample_type_t TYPES are
-- intentionally NOT dropped — the legacy `samples` table (001) still uses them.

-- ---- (a) new follow-up + country columns -----------------------------
ALTER TABLE specialty_samples
  ADD COLUMN IF NOT EXISTS country              text,
  ADD COLUMN IF NOT EXISTS feedback_requested   text,
  ADD COLUMN IF NOT EXISTS feedback_received    text,
  ADD COLUMN IF NOT EXISTS order_placed         text,
  ADD COLUMN IF NOT EXISTS new_sample_requested text,
  ADD COLUMN IF NOT EXISTS new_sample           text;

ALTER TABLE bulk_samples
  ADD COLUMN IF NOT EXISTS feedback_requested   text,
  ADD COLUMN IF NOT EXISTS feedback_received    text,
  ADD COLUMN IF NOT EXISTS order_placed         text,
  ADD COLUMN IF NOT EXISTS new_sample_requested text,
  ADD COLUMN IF NOT EXISTS new_sample           text;

ALTER TABLE forwarding_samples
  ADD COLUMN IF NOT EXISTS feedback_requested   text,
  ADD COLUMN IF NOT EXISTS feedback_received    text,
  ADD COLUMN IF NOT EXISTS order_placed         text,
  ADD COLUMN IF NOT EXISTS new_sample_requested text,
  ADD COLUMN IF NOT EXISTS new_sample           text;

-- ---- (b) enum -> text for the open-ended normalized fields ------------
-- all_samples_v depends on courier_norm/sample_type_norm; CREATE OR REPLACE
-- cannot change a view column's type, so drop it, alter, then recreate.
DROP VIEW IF EXISTS all_samples_v;

ALTER TABLE specialty_samples  ALTER COLUMN courier_norm     TYPE text USING courier_norm::text;
ALTER TABLE bulk_samples       ALTER COLUMN courier_norm     TYPE text USING courier_norm::text;
ALTER TABLE forwarding_samples ALTER COLUMN courier_norm     TYPE text USING courier_norm::text;
ALTER TABLE specialty_samples  ALTER COLUMN sample_type_norm TYPE text USING sample_type_norm::text;
ALTER TABLE bulk_samples       ALTER COLUMN sample_type_norm TYPE text USING sample_type_norm::text;

-- Recreate the cross-table read view (same 17 columns/order as 003). Changes
-- vs 003: courier_norm/sample_type_norm are now text; specialty projects its
-- real `country`; forwarding's sample_type slot is NULL::text (was ::sample_type_t).
CREATE VIEW all_samples_v AS
  SELECT 'specialty'::text AS tab, id, ref AS ref, description AS title,
         receiver_company AS receiver, country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at, sample_type_norm
    FROM specialty_samples
  UNION ALL
  SELECT 'bulk', id, sample_ref, quality, client, country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at, sample_type_norm
    FROM bulk_samples
  UNION ALL
  SELECT 'forwarding', id, sample_ref, coffee_quality, receiver_company, origin,
         client_id, status, courier_norm, awb, qty_grams, date_on,
         NULL::date, NULL::result_t, created_at, deleted_at, NULL::text
    FROM forwarding_samples;

-- ---- (c) re-derive status from source signals ------------------------
-- Highest signal wins: a logged result outranks a delivery, which outranks
-- being in transit. Never touch soft-deleted or explicitly cancelled rows.
UPDATE specialty_samples SET status = (CASE
    WHEN result_norm IS NOT NULL                                   THEN 'results_in'
    WHEN delivery_on IS NOT NULL                                   THEN 'delivered'
    WHEN (awb IS NOT NULL AND awb <> '') OR courier_norm IS NOT NULL THEN 'dispatched'
    ELSE 'requested'
  END)::sample_status_t
  WHERE deleted_at IS NULL AND status <> 'cancelled';

UPDATE bulk_samples SET status = (CASE
    WHEN result_norm IS NOT NULL                                   THEN 'results_in'
    WHEN delivery_on IS NOT NULL                                   THEN 'delivered'
    WHEN (awb IS NOT NULL AND awb <> '') OR courier_norm IS NOT NULL THEN 'dispatched'
    ELSE 'requested'
  END)::sample_status_t
  WHERE deleted_at IS NULL AND status <> 'cancelled';

-- Forwarding has no result_norm/delivery_on columns (reduced lifecycle).
UPDATE forwarding_samples SET status = (CASE
    WHEN (awb IS NOT NULL AND awb <> '') OR courier_norm IS NOT NULL THEN 'dispatched'
    ELSE 'requested'
  END)::sample_status_t
  WHERE deleted_at IS NULL AND status <> 'cancelled';
