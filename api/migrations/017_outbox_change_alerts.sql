-- 017: Change alerts to the Quality team (Harriet, 2026-09-09: "Any changes done from previous requests to
--      be communicated to the quality team — i.e. send email warning if a sample gets deleted").
--
-- The proactive-notification outbox (013) grows from "four sample events" into the one bus for every
-- alert: deletes of samples / clients / consignments (by anyone) and edits to a sample's request
-- definition (by non-QC actors) — later also tracking and PSS events. Changes:
--   • the event CHECK goes (events are validated in TS, api/src/lib/notify-outbox.ts OUTBOX_EVENTS);
--   • tab widens to client / consignment / contract / import (sample_id then holds that entity's id);
--   • dedupe_key: '' keeps the once-per-(entity, event) rule for the original events; edits use a
--     per-edit key so every change is its own row; payload carries the field diff; actor who did it.
-- Idempotent — deploy-api.sh re-applies files on every deploy.

ALTER TABLE notifications_outbox DROP CONSTRAINT IF EXISTS notifications_outbox_event_check;
ALTER TABLE notifications_outbox DROP CONSTRAINT IF EXISTS notifications_outbox_tab_check;
ALTER TABLE notifications_outbox ADD CONSTRAINT notifications_outbox_tab_check
  CHECK (tab IN ('specialty','bulk','forwarding','client','consignment','contract','import'));
ALTER TABLE notifications_outbox ADD COLUMN IF NOT EXISTS dedupe_key text NOT NULL DEFAULT '';
ALTER TABLE notifications_outbox ADD COLUMN IF NOT EXISTS payload    jsonb;
ALTER TABLE notifications_outbox ADD COLUMN IF NOT EXISTS actor      text;
ALTER TABLE notifications_outbox DROP CONSTRAINT IF EXISTS notifications_outbox_tab_sample_id_event_key;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_outbox_dedupe_idx
  ON notifications_outbox (tab, sample_id, event, dedupe_key);
COMMENT ON COLUMN notifications_outbox.sample_id IS 'entity id: sample row, or the client / consignment / contract / import row for those tabs';
