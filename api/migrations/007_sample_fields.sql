-- 007: New per-sample fields from the July 2026 feedback batch.
--
-- ④ blend            — canonical blend string (e.g. "AA PLUS 30% / AB 70%"), distinct from the
--                      free-text quality/description. Feeds the Phase-4 blend-history query.
-- ⑤ rejection_reason — why a sample was rejected; shown only when result = rejected.
-- ⑩ shipment_month   — shipment month for pre-shipment (PSS) samples (Bernard).
-- ⑪ contract_number  — contract number for PSS / shipment samples (Muki).
-- ⑦ location         — lab the sample sits at (Westlands / Thika). Free text with UI suggestions,
--                      matching the courier_norm/sample_type_norm free-text pattern (migration 004);
--                      in Phase 3 a sample's effective location is inherited from its consignment.
--
-- All columns are nullable text and default NULL, so existing rows and every current insert path
-- keep working unchanged. blend/rejection_reason/shipment_month/contract_number apply to the two
-- cupped books (specialty, commercial); location applies to all three.

ALTER TABLE specialty_samples
  ADD COLUMN blend            text,
  ADD COLUMN rejection_reason text,
  ADD COLUMN shipment_month   text,
  ADD COLUMN contract_number  text,
  ADD COLUMN location         text;

ALTER TABLE bulk_samples
  ADD COLUMN blend            text,
  ADD COLUMN rejection_reason text,
  ADD COLUMN shipment_month   text,
  ADD COLUMN contract_number  text,
  ADD COLUMN location         text;

ALTER TABLE forwarding_samples
  ADD COLUMN location text;
