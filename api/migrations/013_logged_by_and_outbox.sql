-- 013: Logged-by / Sales-Trader split + proactive-notification outbox (feedback #28-30 — Ivo Jr., 2026-08-20:
--      "log both the person logging the ask and the person who requested it"; "bot to proactively communicate
--      to Quality when a request is added in full, and to the Sales Trader as status progresses").
--
-- logged_by — who typed the request into the bot (auto-stamped from the Teams profile; never asked).
--             The existing requested_by column is re-badged "Sales Trader" in the UI — no rename, no backfill;
--             NULL logged_by = pre-feature row.
-- notifications_outbox — one row per (sample, event) the notifier job still has to deliver. Enqueued inside
--             the same transaction as the sample write (runWithEvent extraWrites), so dashboard edits count too.
--             UNIQUE(tab, sample_id, event) makes enqueueing idempotent; sent_at is the delivered stamp;
--             attempts/last_error let unresolvable recipients age out instead of clogging the queue.
--
-- Every statement is idempotent (IF NOT EXISTS / DROP IF EXISTS): the migrate runner has no applied-
-- migrations ledger, and prod applies files individually via psql, so re-application must be safe.

ALTER TABLE specialty_samples  ADD COLUMN IF NOT EXISTS logged_by text;
ALTER TABLE bulk_samples       ADD COLUMN IF NOT EXISTS logged_by text;
ALTER TABLE forwarding_samples ADD COLUMN IF NOT EXISTS logged_by text;

CREATE TABLE IF NOT EXISTS notifications_outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab        text NOT NULL CHECK (tab IN ('specialty','bulk','forwarding')),
  sample_id  uuid NOT NULL,
  -- created → Quality team; preparing/dispatched/awb_added → the row's sales trader (requested_by).
  event      text NOT NULL CHECK (event IN ('created','preparing','dispatched','awb_added')),
  -- 'qc' for created; the sales-trader name (free text, matched against traders at send time) otherwise.
  recipient  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz,
  attempts   int NOT NULL DEFAULT 0,
  last_error text,
  UNIQUE (tab, sample_id, event)
);
CREATE INDEX IF NOT EXISTS notifications_outbox_pending_idx ON notifications_outbox (created_at) WHERE sent_at IS NULL;

-- Timeline verb for Teams-DM deliveries (email deliveries keep using 'email_sent', added in 010).
ALTER TYPE entity_event_t ADD VALUE IF NOT EXISTS 'notified';

-- Recreate the cross-table read view: same 28 columns/order as migration 011, with logged_by appended as col 29.
DROP VIEW IF EXISTS all_samples_v;
CREATE VIEW all_samples_v AS
  SELECT 'specialty'::text AS tab, id, ref AS ref, description AS title,
         receiver_company AS receiver, country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at, sample_type_norm, phyto_cert,
         blend, strategy, highlights, result_on,
         location, requested_by, completed_by, stock_grams, dispatched_on, priority, logged_by
    FROM specialty_samples
  UNION ALL
  SELECT 'bulk', id, sample_ref, quality, client, country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at, sample_type_norm, phyto_cert,
         blend, strategy, highlights, result_on,
         location, requested_by, completed_by, stock_grams, dispatched_on, priority, logged_by
    FROM bulk_samples
  UNION ALL
  SELECT 'forwarding', id, sample_ref, coffee_quality, receiver_company, origin,
         client_id, status, courier_norm, awb, qty_grams, date_on,
         NULL::date, NULL::result_t, created_at, deleted_at, NULL::text, phyto_cert,
         NULL::text, NULL::text, NULL::text, NULL::date,
         location, requested_by, completed_by, stock_grams, dispatched_on, priority, logged_by
    FROM forwarding_samples;
