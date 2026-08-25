-- 014: "Keep in the loop" contacts (feedback #34 — Ivo Jr., clarified 2026-08-25).
--
-- The person kept in the loop on a sample is Sucafina's ACCOUNT MANAGER for the client on the
-- sales/destination side (a tier below Ivo; fields the client's "is it on the way?" questions) —
-- one per client, stored in clients.account_owner_id (a traders row, since migration 002).
-- Per sample, extra people can be added ("keep Thomas in the loop on TYPE-1020"): notify_trader_ids.
--
-- Status pings (preparing / dispatched / awb_added) now resolve their recipients AT SEND TIME from
-- these two sources (see GET /notifications/outbox-pending → recipients[]), not from requested_by,
-- which stays what it was: the origin trader who raised the request.
--
-- Idempotent (IF NOT EXISTS): prod applies files individually via psql; re-application must be safe.

ALTER TABLE specialty_samples  ADD COLUMN IF NOT EXISTS notify_trader_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE bulk_samples       ADD COLUMN IF NOT EXISTS notify_trader_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE forwarding_samples ADD COLUMN IF NOT EXISTS notify_trader_ids uuid[] NOT NULL DEFAULT '{}';
