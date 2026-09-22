-- 023: Lots (ref = coffee) and orders (consignments as the request unit) — round 10.
--
-- Verified with the desk: the sample ref names the COFFEE, not the send. The same ref is reused when the
-- same coffee goes out again (SL-7336 → three receivers; TYPE-973 → Johanson twice); different coffee must
-- never share a ref (the TYPE-113 bug: one ref, two qualities). Rows may therefore share a ref BY DESIGN —
-- there is deliberately NO unique index on the ref columns. `lots` is the identity: one row per ref,
-- carrying the coffee it names (coffee_key). `lot_conflicts` lists the live rows whose coffee disagrees with
-- their lot (scripts/lot-conflicts.ts re-issues them).
--
-- Consignments become the ORDER: one request, one client, several sends (client_id / requested_by / logged_by).
--
-- Idempotent — deploy-api.sh re-applies every file on every deploy. The backfill is guarded by
-- ON CONFLICT DO NOTHING / NOT EXISTS, the functions by CREATE OR REPLACE.

-- ---- ref + coffee normalisation, once, in SQL (mirrored by api/src/lib/lots.ts; the tests pin parity) ----

-- "type - 980" → "TYPE-980": trim, upper-case, collapse whitespace, collapse `\s*-\s*` to "-", and join a
-- bare "PREFIX 980" with a dash. Every ref comparison in the API goes through this.
CREATE OR REPLACE FUNCTION normalize_ref(s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(upper(btrim(COALESCE(s, ''))), '\s+', ' ', 'g'),
             '\s*-\s*', '-', 'g'),
           '^([A-Z]+) (\d)', '\1-\2')
$$;

-- Lower-case; split a blend on "," or "/"; per part strip punctuation except "%", drop the noise words
-- ("type sample", "sample", "samples", "replacement"), collapse whitespace; sort the parts and re-join with
-- " / " so a blend is order-insensitive. "TYPE SAMPLE B" → "b"; "ARABICA SAMPLE B" → "arabica b".
CREATE OR REPLACE FUNCTION normalize_quality(s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(string_agg(p, ' / ' ORDER BY p), '')
    FROM (
      SELECT btrim(regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(lower(part), '[^[:alnum:][:space:]%]', ' ', 'g'),
                   '\mtype sample\M', ' ', 'g'),
                 '\m(sample|samples|replacement)\M', ' ', 'g'),
               '\s+', ' ', 'g')) AS p
        FROM regexp_split_to_table(COALESCE(s, ''), '[,/]') AS part
    ) parts
   WHERE p <> ''
$$;

-- The coffee a row names. Specialty: outturn|grade (fallback: normalised description|grade).
-- Commercial: normalised quality|normalised blend.
CREATE OR REPLACE FUNCTION coffee_key(book text, outturn text, grade text, quality text, blend text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN book = 'specialty' THEN
      CASE WHEN COALESCE(btrim(outturn), '') <> ''
           THEN upper(btrim(outturn)) || '|' || upper(COALESCE(btrim(grade), ''))
           ELSE normalize_quality(quality) || '|' || upper(COALESCE(btrim(grade), '')) END
    ELSE normalize_quality(quality) || '|' || normalize_quality(blend)
  END
$$;

-- ---- lots -----------------------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lots (
  ref             text PRIMARY KEY,                       -- normalised (normalize_ref)
  book            text CHECK (book IN ('specialty','commercial')),
  coffee_key      text NOT NULL,
  outturn         text,
  grade           text,
  quality         text,
  blend           text,
  first_issued_at timestamptz NOT NULL DEFAULT now(),
  created_by      text
);
CREATE INDEX IF NOT EXISTS lots_book_coffee_idx ON lots (book, coffee_key);

CREATE TABLE IF NOT EXISTS lot_conflicts (
  ref         text,
  book        text,
  tab         text,
  sample_id   uuid,
  coffee_key  text,
  quality     text,
  outturn     text,
  grade       text,
  detected_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lot_conflicts_sample_idx ON lot_conflicts (ref, sample_id);

-- Ref identity is normalize_ref(ref): index it so the per-row send counts and the ?ref= filters stay cheap.
CREATE INDEX IF NOT EXISTS specialty_ref_norm_idx  ON specialty_samples  (normalize_ref(ref))        WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bulk_ref_norm_idx       ON bulk_samples       (normalize_ref(sample_ref)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS forwarding_ref_norm_idx ON forwarding_samples (normalize_ref(sample_ref)) WHERE deleted_at IS NULL;

-- ---- orders = consignments --------------------------------------------------------------------------------

ALTER TABLE consignments ADD COLUMN IF NOT EXISTS client_id    uuid REFERENCES clients(id);
ALTER TABLE consignments ADD COLUMN IF NOT EXISTS requested_by text;
ALTER TABLE consignments ADD COLUMN IF NOT EXISTS logged_by    text;
CREATE INDEX IF NOT EXISTS consignments_client_idx ON consignments (client_id);

-- ---- backfill ---------------------------------------------------------------------------------------------

-- One lot per distinct live ref across both books; the OLDEST live row is the coffee the ref names.
INSERT INTO lots (ref, book, coffee_key, outturn, grade, quality, blend, first_issued_at, created_by)
SELECT DISTINCT ON (ref) ref, book, coffee_key(book, outturn, grade, quality, blend), outturn, grade, quality, blend, created_at, 'migration:023'
  FROM (
    SELECT normalize_ref(ref) AS ref, 'specialty'::text AS book, outturn, grade, description AS quality, blend, created_at
      FROM specialty_samples WHERE deleted_at IS NULL AND COALESCE(btrim(ref), '') <> ''
    UNION ALL
    SELECT normalize_ref(sample_ref), 'commercial', NULL, NULL, quality, blend, created_at
      FROM bulk_samples WHERE deleted_at IS NULL AND COALESCE(btrim(sample_ref), '') <> ''
  ) live
 ORDER BY ref, created_at
ON CONFLICT (ref) DO NOTHING;

-- Every live row whose coffee disagrees with its lot's (TYPE-113: one ref, two qualities).
INSERT INTO lot_conflicts (ref, book, tab, sample_id, coffee_key, quality, outturn, grade)
SELECT live.ref, live.book, live.tab, live.id, live.ck, live.quality, live.outturn, live.grade
  FROM (
    SELECT normalize_ref(ref) AS ref, 'specialty'::text AS book, 'specialty'::text AS tab, id,
           coffee_key('specialty', outturn, grade, description, blend) AS ck, description AS quality, outturn, grade
      FROM specialty_samples WHERE deleted_at IS NULL AND COALESCE(btrim(ref), '') <> ''
    UNION ALL
    SELECT normalize_ref(sample_ref), 'commercial', 'bulk', id,
           coffee_key('commercial', NULL, NULL, quality, blend), quality, NULL, NULL
      FROM bulk_samples WHERE deleted_at IS NULL AND COALESCE(btrim(sample_ref), '') <> ''
  ) live
  JOIN lots l ON l.ref = live.ref
 WHERE l.coffee_key <> live.ck
ON CONFLICT (ref, sample_id) DO NOTHING;

-- ---- cross-table read view --------------------------------------------------------------------------------
-- Same 32 columns/order as migration 016, plus cols 33–34: lot_sends (live rows on this ref in the same
-- table — the row itself counts, so a live row is never below 1) and consignment_number.
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
              ELSE (SELECT count(*)::int FROM specialty_samples s WHERE s.deleted_at IS NULL AND normalize_ref(s.ref) = normalize_ref(t.ref)) END AS lot_sends,
         (SELECT c.number FROM consignments c WHERE c.id = t.consignment_id) AS consignment_number
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
              ELSE (SELECT count(*)::int FROM bulk_samples s WHERE s.deleted_at IS NULL AND normalize_ref(s.sample_ref) = normalize_ref(t.sample_ref)) END,
         (SELECT c.number FROM consignments c WHERE c.id = t.consignment_id)
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
              ELSE (SELECT count(*)::int FROM forwarding_samples s WHERE s.deleted_at IS NULL AND normalize_ref(s.sample_ref) = normalize_ref(t.sample_ref)) END,
         (SELECT c.number FROM consignments c WHERE c.id = t.consignment_id)
    FROM forwarding_samples t;
