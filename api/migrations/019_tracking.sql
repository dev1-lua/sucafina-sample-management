-- 019: Courier tracking (Harriet, round 6: "once an AWB is added, automatically look up the AWB for changes").
-- Five tracking columns on each book + a partial index over the sweep pool (dispatched rows with an AWB).
-- No view change: lists/GET return t.*, and the AWB lookup unions the three tables. Idempotent.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['specialty_samples','bulk_samples','forwarding_samples'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tracking_status text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tracking_last_event text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tracking_last_event_at timestamptz', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tracking_checked_at timestamptz', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tracking_exception text', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (tracking_checked_at) WHERE status = ''dispatched'' AND awb IS NOT NULL AND deleted_at IS NULL', t || '_tracking_pool_idx', t);
  END LOOP; END $$;
COMMENT ON COLUMN bulk_samples.tracking_status IS 'pre_transit|in_transit|out_for_delivery|delivered|exception|unknown — last provider answer (api/src/lib/tracking.ts)';
