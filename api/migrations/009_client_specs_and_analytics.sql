-- 009: Client specs + approved-sample analytics (feedback ⑬⑭⑯).
--
-- ⑯ Client specs (Lynne): a per-client guide the desk consults when sending samples —
--    preferred grades, target cup profile, moisture ceiling, minimum score, free notes.
-- ⑬ Approved-sample attributes (Omar): `strategy` (the assigned strategy) and `highlights`
--    (cup-profile tags like "Blackcurrant bomb, Strict Clean Cups") on the two cupped books.
-- ⑭ Feedback timing (Omar): `result_on` — the date a cupping verdict was logged — so average
--    delivered→result turnaround becomes computable. Auto-stamped by the routes when a result is
--    first recorded; historical rows stay NULL (we don't know when their verdict actually arrived),
--    so they simply don't count toward the average rather than reporting a false 0-day turnaround.

ALTER TABLE clients
  ADD COLUMN spec_grades       text,
  ADD COLUMN spec_cup_profile  text,
  ADD COLUMN spec_moisture_max numeric,
  ADD COLUMN spec_min_score    numeric,
  ADD COLUMN spec_notes        text;

ALTER TABLE specialty_samples
  ADD COLUMN strategy   text,
  ADD COLUMN highlights text,
  ADD COLUMN result_on  date;

ALTER TABLE bulk_samples
  ADD COLUMN strategy   text,
  ADD COLUMN highlights text,
  ADD COLUMN result_on  date;

-- Recreate the cross-table read view: same 18 columns/order as migration 005, with blend, strategy,
-- highlights (all from migration 007's blend + this migration) and result_on appended as cols 19-22.
-- Forwarding has none of these, so it supplies NULLs to keep the UNION type-aligned.
DROP VIEW IF EXISTS all_samples_v;
CREATE VIEW all_samples_v AS
  SELECT 'specialty'::text AS tab, id, ref AS ref, description AS title,
         receiver_company AS receiver, country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at, sample_type_norm, phyto_cert,
         blend, strategy, highlights, result_on
    FROM specialty_samples
  UNION ALL
  SELECT 'bulk', id, sample_ref, quality, client, country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at, sample_type_norm, phyto_cert,
         blend, strategy, highlights, result_on
    FROM bulk_samples
  UNION ALL
  SELECT 'forwarding', id, sample_ref, coffee_quality, receiver_company, origin,
         client_id, status, courier_norm, awb, qty_grams, date_on,
         NULL::date, NULL::result_t, created_at, deleted_at, NULL::text, phyto_cert,
         NULL::text, NULL::text, NULL::text, NULL::date
    FROM forwarding_samples;
