-- 025: Send ID — round 11 (Ivo, Harriet, Daniel, 2026-09-28).
--
-- A reference names the COFFEE (SL-7307 = one stock lot; the same coffee sent to five clients keeps ONE ref),
-- so the ref cannot also identify the row. Every send in the three books now carries its own immutable
-- `send_id`, format SS-<n> (unpadded, like CN-1012 / SL-7459), minted by the DB on insert from the `SS`
-- ref_counters row (seeded at 1000) — one BEFORE INSERT trigger per table, riding the insert's own
-- transaction, so every insert path (routes, drawPss, importer, seed, tests) gets one and a rolled-back
-- insert burns nothing worse than a number. NOT on the legacy `samples` table.
--
-- Immutable: a BEFORE UPDATE trigger keeps the value once set; nothing app-side may mint or change it, and a
-- soft-delete never hands the number back (deliberately NOT releaseRefIfLatest).
--
-- Backfill: every row (live AND deleted) of the three tables still without a send_id, numbered
-- chronologically ACROSS the tables by COALESCE(date_on, created_at::date), created_at, id, from a block
-- reserved on the counter in one step (pattern: migration 006). Re-applying finds nothing to fill.
--
-- all_samples_v restated in full (024's 34 columns, order untouched) with two trailing columns:
-- 35 send_id, 36 option_letter (the row's column, else the letter its SSKE ref carries — exactly what
-- lib/lots.ts SENDS_SQL exposes; NULL for forwarding, which has no option_letter column).
--
-- Idempotent — deploy-api.sh re-applies 023 and 024 (which recreate the view in their OLD shape) then this
-- file on every deploy; this file must always run last and bring the view forward.

-- ---- 1. column + counter + event type ----------------------------------------------------------------------
ALTER TABLE specialty_samples  ADD COLUMN IF NOT EXISTS send_id text;
ALTER TABLE bulk_samples       ADD COLUMN IF NOT EXISTS send_id text;
ALTER TABLE forwarding_samples ADD COLUMN IF NOT EXISTS send_id text;
COMMENT ON COLUMN specialty_samples.send_id  IS 'Send ID SS-<n>: unique to this row, minted by the DB on insert, immutable. The ref names the coffee and is shared by every send of it.';
COMMENT ON COLUMN bulk_samples.send_id       IS 'Send ID SS-<n>: unique to this row, minted by the DB on insert, immutable. The ref names the coffee and is shared by every send of it.';
COMMENT ON COLUMN forwarding_samples.send_id IS 'Send ID SS-<n>: unique to this row, minted by the DB on insert, immutable. The ref names the coffee and is shared by every send of it.';

INSERT INTO ref_counters (prefix, next_val) VALUES ('SS', 1000) ON CONFLICT (prefix) DO NOTHING;

-- QC may re-ref a row from the dashboard (round 11 §2): the audit row for that edit. Added here, used only
-- by later transactions (an enum value cannot be used in the transaction that adds it).
ALTER TYPE entity_event_t ADD VALUE IF NOT EXISTS 'ref_changed';

-- ---- 2. mint + triggers ------------------------------------------------------------------------------------
-- The same UPDATE … RETURNING next_val - 1 pattern as issueRef / issueConsignmentNumber (lib/refs.ts).
CREATE OR REPLACE FUNCTION next_send_id() RETURNS text
LANGUAGE sql VOLATILE AS $$
  UPDATE ref_counters SET next_val = next_val + 1 WHERE prefix = 'SS' RETURNING 'SS-' || (next_val - 1)
$$;

CREATE OR REPLACE FUNCTION set_send_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.send_id IS NULL OR btrim(NEW.send_id) = '' THEN
    NEW.send_id := next_send_id();
  END IF;
  RETURN NEW;
END $$;

-- Once set, a send id never changes: an UPDATE that tries to is silently kept on the old value.
CREATE OR REPLACE FUNCTION keep_send_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.send_id IS NOT NULL THEN
    NEW.send_id := OLD.send_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS specialty_send_id_ins  ON specialty_samples;
DROP TRIGGER IF EXISTS bulk_send_id_ins       ON bulk_samples;
DROP TRIGGER IF EXISTS forwarding_send_id_ins ON forwarding_samples;
CREATE TRIGGER specialty_send_id_ins  BEFORE INSERT ON specialty_samples  FOR EACH ROW EXECUTE FUNCTION set_send_id();
CREATE TRIGGER bulk_send_id_ins       BEFORE INSERT ON bulk_samples       FOR EACH ROW EXECUTE FUNCTION set_send_id();
CREATE TRIGGER forwarding_send_id_ins BEFORE INSERT ON forwarding_samples FOR EACH ROW EXECUTE FUNCTION set_send_id();

DROP TRIGGER IF EXISTS specialty_send_id_upd  ON specialty_samples;
DROP TRIGGER IF EXISTS bulk_send_id_upd       ON bulk_samples;
DROP TRIGGER IF EXISTS forwarding_send_id_upd ON forwarding_samples;
CREATE TRIGGER specialty_send_id_upd  BEFORE UPDATE OF send_id ON specialty_samples  FOR EACH ROW EXECUTE FUNCTION keep_send_id();
CREATE TRIGGER bulk_send_id_upd       BEFORE UPDATE OF send_id ON bulk_samples       FOR EACH ROW EXECUTE FUNCTION keep_send_id();
CREATE TRIGGER forwarding_send_id_upd BEFORE UPDATE OF send_id ON forwarding_samples FOR EACH ROW EXECUTE FUNCTION keep_send_id();

-- ---- 3. backfill (block-reserved, chronological across the three tables; no-op on re-apply) ---------------
DO $$
DECLARE
  n int;
  start_val int;
BEGIN
  CREATE TEMP TABLE send_id_backfill AS
    SELECT tab, id,
           row_number() OVER (ORDER BY COALESCE(date_on, created_at::date), created_at, id) - 1 AS rn
      FROM (
        SELECT 'specialty'::text AS tab, id, date_on, created_at FROM specialty_samples  WHERE send_id IS NULL
        UNION ALL
        SELECT 'bulk',                  id, date_on, created_at FROM bulk_samples       WHERE send_id IS NULL
        UNION ALL
        SELECT 'forwarding',            id, date_on, created_at FROM forwarding_samples WHERE send_id IS NULL
      ) missing;
  SELECT count(*) INTO n FROM send_id_backfill;
  IF n > 0 THEN
    UPDATE ref_counters SET next_val = next_val + n WHERE prefix = 'SS' RETURNING next_val - n INTO start_val;
    UPDATE specialty_samples  t SET send_id = 'SS-' || (start_val + b.rn) FROM send_id_backfill b WHERE b.tab = 'specialty'  AND b.id = t.id;
    UPDATE bulk_samples       t SET send_id = 'SS-' || (start_val + b.rn) FROM send_id_backfill b WHERE b.tab = 'bulk'       AND b.id = t.id;
    UPDATE forwarding_samples t SET send_id = 'SS-' || (start_val + b.rn) FROM send_id_backfill b WHERE b.tab = 'forwarding' AND b.id = t.id;
  END IF;
  DROP TABLE send_id_backfill;
END $$;

-- ---- 4. unique per table (live and deleted alike: a number is never reused) --------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS specialty_send_id_uidx  ON specialty_samples  (send_id);
CREATE UNIQUE INDEX IF NOT EXISTS bulk_send_id_uidx       ON bulk_samples       (send_id);
CREATE UNIQUE INDEX IF NOT EXISTS forwarding_send_id_uidx ON forwarding_samples (send_id);

-- ---- 5. all_samples_v: 024's 34 columns in the same order + send_id (35) + option_letter (36) ---------------
DROP VIEW IF EXISTS all_samples_v;
CREATE VIEW all_samples_v AS
  SELECT 'specialty'::text AS tab, t.id, t.ref AS ref, t.description AS title,
         t.receiver_company AS receiver, t.country, t.client_id, t.status,
         t.courier_norm, t.awb, t.qty_grams, t.date_on, t.delivery_on, t.result_norm,
         t.created_at, t.deleted_at, t.sample_type_norm, t.phyto_cert,
         t.blend, t.strategy, t.highlights, t.result_on,
         t.location, t.requested_by, t.completed_by, t.stock_grams, t.dispatched_on, t.priority, t.logged_by,
         client_address_missing(t.client_id) AS client_address_missing,
         (SELECT r.asked_name FROM client_detail_requests r WHERE r.client_id = t.client_id AND r.resolved_at IS NULL) AS details_requested_from,
         (SELECT r.asked_at   FROM client_detail_requests r WHERE r.client_id = t.client_id AND r.resolved_at IS NULL) AS details_requested_at,
         CASE WHEN COALESCE(btrim(t.ref), '') = '' THEN 1
              ELSE (SELECT count(*)::int FROM specialty_samples s WHERE s.deleted_at IS NULL AND lot_ref(s.ref) = lot_ref(t.ref)) END AS lot_sends,
         (SELECT c.number FROM consignments c WHERE c.id = t.consignment_id) AS consignment_number,
         t.send_id,
         COALESCE(t.option_letter, ref_option_letter(t.ref)) AS option_letter
    FROM specialty_samples t
  UNION ALL
  SELECT 'bulk', t.id, t.sample_ref, t.quality, t.client, t.country, t.client_id, t.status,
         t.courier_norm, t.awb, t.qty_grams, t.date_on, t.delivery_on, t.result_norm,
         t.created_at, t.deleted_at, t.sample_type_norm, t.phyto_cert,
         t.blend, t.strategy, t.highlights, t.result_on,
         t.location, t.requested_by, t.completed_by, t.stock_grams, t.dispatched_on, t.priority, t.logged_by,
         client_address_missing(t.client_id),
         (SELECT r.asked_name FROM client_detail_requests r WHERE r.client_id = t.client_id AND r.resolved_at IS NULL),
         (SELECT r.asked_at   FROM client_detail_requests r WHERE r.client_id = t.client_id AND r.resolved_at IS NULL),
         CASE WHEN COALESCE(btrim(t.sample_ref), '') = '' THEN 1
              ELSE (SELECT count(*)::int FROM bulk_samples s WHERE s.deleted_at IS NULL AND lot_ref(s.sample_ref) = lot_ref(t.sample_ref)) END,
         (SELECT c.number FROM consignments c WHERE c.id = t.consignment_id),
         t.send_id,
         COALESCE(t.option_letter, ref_option_letter(t.sample_ref))
    FROM bulk_samples t
  UNION ALL
  SELECT 'forwarding', t.id, t.sample_ref, t.coffee_quality, t.receiver_company, t.origin,
         t.client_id, t.status, t.courier_norm, t.awb, t.qty_grams, t.date_on,
         NULL::date, NULL::result_t, t.created_at, t.deleted_at, NULL::text, t.phyto_cert,
         NULL::text, NULL::text, NULL::text, NULL::date,
         t.location, t.requested_by, t.completed_by, t.stock_grams, t.dispatched_on, t.priority, t.logged_by,
         client_address_missing(t.client_id),
         (SELECT r.asked_name FROM client_detail_requests r WHERE r.client_id = t.client_id AND r.resolved_at IS NULL),
         (SELECT r.asked_at   FROM client_detail_requests r WHERE r.client_id = t.client_id AND r.resolved_at IS NULL),
         CASE WHEN COALESCE(btrim(t.sample_ref), '') = '' THEN 1
              ELSE (SELECT count(*)::int FROM forwarding_samples s WHERE s.deleted_at IS NULL AND lot_ref(s.sample_ref) = lot_ref(t.sample_ref)) END,
         (SELECT c.number FROM consignments c WHERE c.id = t.consignment_id),
         t.send_id,
         NULL::text
    FROM forwarding_samples t;
