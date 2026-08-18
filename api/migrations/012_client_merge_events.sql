-- 012: Client merge audit events (feedback #27 — Sam, 2026-07-24: "Paulig" + "Gustav Paulig Ltd (NEW)
--      Jan 23" are the same company; "merge them together").
--
-- No schema change — POST /clients/:id/merge re-points sample rows and folds contacts inside one
-- transaction. This migration only adds the two event types the endpoint writes:
--   merged      — on the surviving (target) client: lists the folded sources + re-point counts
--   merged_into — on each soft-deleted source: names the target id
--
-- Idempotent (ADD VALUE IF NOT EXISTS): the migrate runner has no applied-migrations ledger, and prod
-- applies files individually via psql, so re-application must be safe.

ALTER TYPE entity_event_t ADD VALUE IF NOT EXISTS 'merged';
ALTER TYPE entity_event_t ADD VALUE IF NOT EXISTS 'merged_into';
