-- 010: Per-client phyto default, request ownership, stock-on-hand, dispatch date + email stamps
--      (feedback: phyto default for a client — Anicka; requested-by / completed-by — Muki;
--       sample stock availability — Anicka; dispatch email + 7-day client chaser — Anicka/Omar).
--
-- default_phyto_cert  — per-client answer to "does this coffee need a phyto cert?"; sample creation
--                       falls back to it when the row is linked to a client and no explicit value given.
-- requested_by        — who placed the sample request (free text; agent fills from the chatting user).
-- completed_by        — who completed/dispatched the request; stamped by the dispatch flow.
-- stock_grams         — grams of this lot the lab still holds. NULL = not tracked. Decremented by
--                       qty_grams on the requested→dispatched transition, floored at 0.
-- dispatched_on       — date the row first went to 'dispatched'. Stamp-once like delivery_on/result_on.
--                       Historical rows stay NULL, which deliberately excludes them from auto-emails.
-- dispatch_notified_at / feedback_chased_at — idempotency stamps for the two outbound client emails
--                       (dispatch confirmation; 7-day feedback chaser). Kept OUT of all_samples_v —
--                       they are plumbing, not desk-facing data. Forwarding gets no feedback chaser
--                       (no delivery/feedback lifecycle), hence no feedback_chased_at there.
--
-- Every statement is idempotent (IF NOT EXISTS / DROP IF EXISTS): the migrate runner has no applied-
-- migrations ledger, and prod applies files individually via psql, so re-application must be safe.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_phyto_cert text;

ALTER TABLE specialty_samples
  ADD COLUMN IF NOT EXISTS requested_by         text,
  ADD COLUMN IF NOT EXISTS completed_by         text,
  ADD COLUMN IF NOT EXISTS stock_grams          integer,
  ADD COLUMN IF NOT EXISTS dispatched_on        date,
  ADD COLUMN IF NOT EXISTS dispatch_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS feedback_chased_at   timestamptz;

ALTER TABLE bulk_samples
  ADD COLUMN IF NOT EXISTS requested_by         text,
  ADD COLUMN IF NOT EXISTS completed_by         text,
  ADD COLUMN IF NOT EXISTS stock_grams          integer,
  ADD COLUMN IF NOT EXISTS dispatched_on        date,
  ADD COLUMN IF NOT EXISTS dispatch_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS feedback_chased_at   timestamptz;

ALTER TABLE forwarding_samples
  ADD COLUMN IF NOT EXISTS requested_by         text,
  ADD COLUMN IF NOT EXISTS completed_by         text,
  ADD COLUMN IF NOT EXISTS stock_grams          integer,
  ADD COLUMN IF NOT EXISTS dispatched_on        date,
  ADD COLUMN IF NOT EXISTS dispatch_notified_at timestamptz;

-- Timeline verb for "we emailed the client about this row".
ALTER TYPE entity_event_t ADD VALUE IF NOT EXISTS 'email_sent';

-- Recreate the cross-table read view: same 22 columns/order as migration 009, with location
-- (from migration 007, present on all three tables — closing the gap where it never made the view)
-- appended as col 23 and requested_by, completed_by, stock_grams, dispatched_on as cols 24-27.
-- The notification stamps are intentionally not exposed here.
DROP VIEW IF EXISTS all_samples_v;
CREATE VIEW all_samples_v AS
  SELECT 'specialty'::text AS tab, id, ref AS ref, description AS title,
         receiver_company AS receiver, country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at, sample_type_norm, phyto_cert,
         blend, strategy, highlights, result_on,
         location, requested_by, completed_by, stock_grams, dispatched_on
    FROM specialty_samples
  UNION ALL
  SELECT 'bulk', id, sample_ref, quality, client, country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at, sample_type_norm, phyto_cert,
         blend, strategy, highlights, result_on,
         location, requested_by, completed_by, stock_grams, dispatched_on
    FROM bulk_samples
  UNION ALL
  SELECT 'forwarding', id, sample_ref, coffee_quality, receiver_company, origin,
         client_id, status, courier_norm, awb, qty_grams, date_on,
         NULL::date, NULL::result_t, created_at, deleted_at, NULL::text, phyto_cert,
         NULL::text, NULL::text, NULL::text, NULL::date,
         location, requested_by, completed_by, stock_grams, dispatched_on
    FROM forwarding_samples;
