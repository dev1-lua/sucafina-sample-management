-- 018: Soft delete for the legacy `samples` table (001) so the pre-2026-08-01 purge (Harriet, round 6:
--      "general clean-up: remove everything before 1 Aug 2026") can hide legacy rows the same way it hides
--      rows in the three books. Nothing is hard-deleted; `scripts/purge-before.ts --restore <purge_ts>`
--      reverses it. The two enum values are added here and used only by that script (never in this file).
-- Idempotent — deploy-api.sh re-applies files on every deploy.
ALTER TABLE samples ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS samples_live_idx ON samples (coalesce(requested_at, created_at)) WHERE deleted_at IS NULL;
ALTER TYPE event_type_t ADD VALUE IF NOT EXISTS 'deleted';
ALTER TYPE event_type_t ADD VALUE IF NOT EXISTS 'restored';
COMMENT ON COLUMN samples.deleted_at IS 'soft delete (set by scripts/purge-before.ts); list routes filter it, GET /:id still resolves';
