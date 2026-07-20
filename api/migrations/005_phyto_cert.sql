-- 005_phyto_cert.sql
--
-- Client feedback (Ivo Jr. Sarjanovic): the desk must clarify/know whether a
-- shipment needs a phytosanitary certificate before it is sent. Stored as a
-- user-maintained free-text field like the 004 follow-up columns — typically
-- "Yes", "No", or "Client to confirm", but any short note is allowed.
--
-- Re-run-safe (IF NOT EXISTS; view dropped + recreated, same approach as 004).

ALTER TABLE specialty_samples  ADD COLUMN IF NOT EXISTS phyto_cert text;
ALTER TABLE bulk_samples       ADD COLUMN IF NOT EXISTS phyto_cert text;
ALTER TABLE forwarding_samples ADD COLUMN IF NOT EXISTS phyto_cert text;

-- Recreate the cross-table read view: same 17 columns/order as 004, with
-- phyto_cert appended as the 18th so status/dispatch lookups can see it.
DROP VIEW IF EXISTS all_samples_v;
CREATE VIEW all_samples_v AS
  SELECT 'specialty'::text AS tab, id, ref AS ref, description AS title,
         receiver_company AS receiver, country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at, sample_type_norm, phyto_cert
    FROM specialty_samples
  UNION ALL
  SELECT 'bulk', id, sample_ref, quality, client, country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at, sample_type_norm, phyto_cert
    FROM bulk_samples
  UNION ALL
  SELECT 'forwarding', id, sample_ref, coffee_quality, receiver_company, origin,
         client_id, status, courier_norm, awb, qty_grams, date_on,
         NULL::date, NULL::result_t, created_at, deleted_at, NULL::text, phyto_cert
    FROM forwarding_samples;
