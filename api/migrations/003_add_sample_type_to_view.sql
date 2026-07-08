-- 003_add_sample_type_to_view.sql
-- Append `sample_type_norm` (column 17) to all_samples_v so the Dashboard's
-- by_sample_type aggregate + the new /stats sample_type filter can run off the
-- single normalized view instead of a separate two-table union. Columns 1-16 are
-- restated verbatim from 002 (CREATE OR REPLACE VIEW requires the existing columns
-- to keep the same name/type/order and only permits appending at the end).
-- specialty + bulk carry sample_type_norm; forwarding has none, so it supplies
-- NULL::sample_type_t to keep the UNION ALL type-aligned.
-- Idempotent (OR REPLACE) and safe for existing consumers (no SELECT * against the
-- view; append-only) — so it can be applied directly to a live/seeded DB.

CREATE OR REPLACE VIEW all_samples_v AS
  SELECT 'specialty'::text AS tab, id, ref AS ref, description AS title,
         receiver_company AS receiver, NULL::text AS country, client_id, status,
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
         NULL::date, NULL::result_t, created_at, deleted_at, NULL::sample_type_t
    FROM forwarding_samples;
