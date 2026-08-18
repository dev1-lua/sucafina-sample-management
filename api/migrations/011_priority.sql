-- 011: Sample priority / urgency flag (feedback #25 — Ivo, 2026-07-24: "add a column where you can
--      flag importance/urgency of the sample").
--
-- priority — 'normal' (default) | 'urgent'. Set on creation ("send it urgently") or later via PATCH.
--            Surfaces as a badge/filter in the dashboard and sorts urgent rows first on the open-sample list.
--
-- Every statement is idempotent (IF NOT EXISTS / DROP IF EXISTS): the migrate runner has no applied-
-- migrations ledger, and prod applies files individually via psql, so re-application must be safe.

ALTER TABLE specialty_samples  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';
ALTER TABLE bulk_samples       ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';
ALTER TABLE forwarding_samples ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

ALTER TABLE specialty_samples  DROP CONSTRAINT IF EXISTS specialty_samples_priority_chk;
ALTER TABLE bulk_samples       DROP CONSTRAINT IF EXISTS bulk_samples_priority_chk;
ALTER TABLE forwarding_samples DROP CONSTRAINT IF EXISTS forwarding_samples_priority_chk;
ALTER TABLE specialty_samples  ADD CONSTRAINT specialty_samples_priority_chk  CHECK (priority IN ('normal','urgent'));
ALTER TABLE bulk_samples       ADD CONSTRAINT bulk_samples_priority_chk       CHECK (priority IN ('normal','urgent'));
ALTER TABLE forwarding_samples ADD CONSTRAINT forwarding_samples_priority_chk CHECK (priority IN ('normal','urgent'));

-- Recreate the cross-table read view: same 27 columns/order as migration 010, with priority appended as col 28.
DROP VIEW IF EXISTS all_samples_v;
CREATE VIEW all_samples_v AS
  SELECT 'specialty'::text AS tab, id, ref AS ref, description AS title,
         receiver_company AS receiver, country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at, sample_type_norm, phyto_cert,
         blend, strategy, highlights, result_on,
         location, requested_by, completed_by, stock_grams, dispatched_on, priority
    FROM specialty_samples
  UNION ALL
  SELECT 'bulk', id, sample_ref, quality, client, country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at, sample_type_norm, phyto_cert,
         blend, strategy, highlights, result_on,
         location, requested_by, completed_by, stock_grams, dispatched_on, priority
    FROM bulk_samples
  UNION ALL
  SELECT 'forwarding', id, sample_ref, coffee_quality, receiver_company, origin,
         client_id, status, courier_norm, awb, qty_grams, date_on,
         NULL::date, NULL::result_t, created_at, deleted_at, NULL::text, phyto_cert,
         NULL::text, NULL::text, NULL::text, NULL::date,
         location, requested_by, completed_by, stock_grams, dispatched_on, priority
    FROM forwarding_samples;
