-- 024: PSS lots group by CONTRACT + a softer quality normaliser — round 10b (Harriet, QC lead, 2026-09-23).
--
-- A pre-shipment sample ref is SSKE-<contract digits><option letter> (SSKE-104929A, B, C …). "The only
-- difference is the suffix alphabet A B C D; we prefer to see them under one group." So the LOT of an SSKE
-- ref is its base, SSKE-<digits> — the contract. The sample ROW keeps its lettered ref (and its option_letter
-- column, where the contracts path filled it); only `lots` and every group-level count key on lot_ref().
-- Legacy sheets also write "SSKE-100470 A" / "SSKE 95986 A" (normalize_ref leaves the space), so lot_ref and
-- ref_option_letter accept one optional space before the letter.
--
-- The quality normaliser (023) was too strict for the desk's spellings: AB-FAQ ≠ AB FAQ, Grinder ≠ Grinders,
-- "AB FAQ RA EUDR Certificate" ≠ "AB FAQ". Softened here (mirrored exactly by normalizeQuality in
-- api/src/lib/lots.ts; test/lots.test.ts pins the parity), then every lot's coffee_key is recomputed and
-- lot_conflicts — derived data — is rebuilt from scratch with the new keys and lot_ref() joins.
--
-- Idempotent — deploy-api.sh re-applies 023 then this file on every deploy. 023 recreates normalize_quality,
-- coffee_key and all_samples_v in their OLD shape; this file must always run after it and bring all three forward.

-- ---- 1. lot key -----------------------------------------------------------------------------------------

-- "SSKE-104929A" / "SSKE-104929 A" → "SSKE-104929"; everything else → normalize_ref(s) unchanged.
CREATE OR REPLACE FUNCTION lot_ref(s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(normalize_ref(s), '^(SSKE-\d+) ?[A-Z]$', '\1')
$$;

-- The option letter an SSKE ref carries ("SSKE-104929 B" → "B"), else NULL. Read-side fallback for the
-- 500+ legacy PSS rows whose option_letter column is empty.
CREATE OR REPLACE FUNCTION ref_option_letter(s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT substring(normalize_ref(s) FROM '^SSKE-\d+ ?([A-Z])$')
$$;

-- ---- 2. softer quality normaliser (== normalizeQuality in api/src/lib/lots.ts) ------------------------------
-- Per part (split on "," or "/"): lower-case; punctuation incl. "-" "_" → space (only "%" survives); collapse
-- whitespace; cut a "same coffee as …" tail; legacy alias inders → grinders (the imported sheet holds the
-- literal "inders FAQ RA EUDR compliance" for a truncated "Grinders" — a data repair, not a fuzzy match);
-- drop the noise words; singularise a trailing "s" on a word of ≥ 5 letters not ending in "ss"
-- (grinders → grinder; faqs, plus, glass stay). Sort the parts and re-join with " / ".
CREATE OR REPLACE FUNCTION normalize_quality(s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(string_agg(p, ' / ' ORDER BY p), '')
    FROM (
      SELECT btrim(regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(
                     regexp_replace(
                       regexp_replace(
                         regexp_replace(lower(part), '[^[:alnum:][:space:]%]', ' ', 'g'),
                         '\s+', ' ', 'g'),
                       '\msame coffee as\M.*$', ' '),
                     '\minders\M', 'grinders', 'g'),
                   '\m(type|sample|samples|replacement|ra|eudr|certificate|certified|compliance|washed|process|arabica|kenya)\M', ' ', 'g'),
                 '\m([a-z]{3,}[a-rt-z])s\M', '\1', 'g'),
               '\s+', ' ', 'g')) AS p
        FROM regexp_split_to_table(COALESCE(s, ''), '[,/]') AS part
    ) parts
   WHERE p <> ''
$$;

-- An all-noise quality ("Kenya", "Washed", "Arabica", "Sample", "same coffee as TYPE-903") normalises to '' —
-- that must not make every such row ONE coffee on the empty key '|' (resolve would reuse whichever lot first
-- took it, lot_conflicts would flag them as one coffee, step 4 below would recompute legacy lots onto it).
-- The KEY of such a quality is its raw text, lower-cased and whitespace-collapsed; a genuinely empty quality
-- stays ''. == qualityKey in api/src/lib/lots.ts. Blends keep the plain normaliser.
CREATE OR REPLACE FUNCTION quality_key(s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(NULLIF(normalize_quality(s), ''), btrim(regexp_replace(lower(COALESCE(s, '')), '\s+', ' ', 'g')))
$$;

-- coffee_key (023) brought forward: the quality part goes through quality_key(). == coffeeKeyFor in lots.ts.
CREATE OR REPLACE FUNCTION coffee_key(book text, outturn text, grade text, quality text, blend text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN book = 'specialty' THEN
      CASE WHEN COALESCE(btrim(outturn), '') <> ''
           THEN upper(btrim(outturn)) || '|' || upper(COALESCE(btrim(grade), ''))
           ELSE quality_key(quality) || '|' || upper(COALESCE(btrim(grade), '')) END
    ELSE quality_key(quality) || '|' || normalize_quality(blend)
  END
$$;

-- Lot identity is lot_ref(ref): index it like 023 indexed normalize_ref(ref) — every lot_sends count and
-- the group reads go through it.
CREATE INDEX IF NOT EXISTS specialty_ref_lot_idx  ON specialty_samples  (lot_ref(ref))        WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bulk_ref_lot_idx       ON bulk_samples       (lot_ref(sample_ref)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS forwarding_ref_lot_idx ON forwarding_samples (lot_ref(sample_ref)) WHERE deleted_at IS NULL;

-- ---- 3. re-key the lettered SSKE lots 023 built ------------------------------------------------------------
-- Per contract with no base lot yet: the OLDEST lettered lot becomes the base (its coffee is the group's).
UPDATE lots l
   SET ref = lot_ref(l.ref)
  FROM (
    SELECT DISTINCT ON (lot_ref(ref)) ref
      FROM lots
     WHERE ref ~ '^SSKE-\d+ ?[A-Z]$'
     ORDER BY lot_ref(ref), first_issued_at, ref
  ) oldest
 WHERE l.ref = oldest.ref
   AND NOT EXISTS (SELECT 1 FROM lots b WHERE b.ref = lot_ref(l.ref));
-- Every remaining lettered lot is a duplicate of its base: its sends are found by lot_ref().
DELETE FROM lots WHERE ref ~ '^SSKE-\d+ ?[A-Z]$';

-- A live SSKE group 023 never saw (all its rows came in after the backfill, or the base lot was released)
-- still gets its lot: oldest live row = the group's coffee.
INSERT INTO lots (ref, book, coffee_key, outturn, grade, quality, blend, first_issued_at, created_by)
SELECT DISTINCT ON (ref) ref, book, coffee_key(book, outturn, grade, quality, blend), outturn, grade, quality, blend, created_at, 'migration:024'
  FROM (
    SELECT lot_ref(ref) AS ref, 'specialty'::text AS book, outturn, grade, description AS quality, blend, created_at
      FROM specialty_samples WHERE deleted_at IS NULL AND lot_ref(ref) ~ '^SSKE-\d+$'
    UNION ALL
    SELECT lot_ref(sample_ref), 'commercial', NULL, NULL, quality, blend, created_at
      FROM bulk_samples WHERE deleted_at IS NULL AND lot_ref(sample_ref) ~ '^SSKE-\d+$'
  ) live
 ORDER BY ref, created_at
ON CONFLICT (ref) DO NOTHING;

-- ---- 4. every lot's coffee_key under the softened normaliser ------------------------------------------------
UPDATE lots
   SET coffee_key = coffee_key(book, outturn, grade, quality, blend)
 WHERE coffee_key IS DISTINCT FROM coffee_key(book, outturn, grade, quality, blend);

-- ---- 5. rebuild lot_conflicts (derived data) ---------------------------------------------------------------
-- 023's detection, joined on lot_ref() with the new keys. PSS groups are left out: the contract, not the
-- quality text, is their identity (scripts/lot-conflicts.ts would otherwise re-issue a contract option under a
-- counter SSKE ref). Rows QC already re-issued now match their lot and do not come back.
DELETE FROM lot_conflicts;
INSERT INTO lot_conflicts (ref, book, tab, sample_id, coffee_key, quality, outturn, grade)
SELECT live.ref, live.book, live.tab, live.id, live.ck, live.quality, live.outturn, live.grade
  FROM (
    SELECT lot_ref(ref) AS ref, 'specialty'::text AS book, 'specialty'::text AS tab, id,
           coffee_key('specialty', outturn, grade, description, blend) AS ck, description AS quality, outturn, grade
      FROM specialty_samples WHERE deleted_at IS NULL AND COALESCE(btrim(ref), '') <> ''
    UNION ALL
    SELECT lot_ref(sample_ref), 'commercial', 'bulk', id,
           coffee_key('commercial', NULL, NULL, quality, blend), quality, NULL, NULL
      FROM bulk_samples WHERE deleted_at IS NULL AND COALESCE(btrim(sample_ref), '') <> ''
  ) live
  JOIN lots l ON l.ref = live.ref
 WHERE l.coffee_key <> live.ck
   AND live.ref !~ '^SSKE-\d+$'
ON CONFLICT (ref, sample_id) DO NOTHING;

-- ---- 6. all_samples_v: lot_sends counts the LOT (lot_ref), otherwise identical to 023 ------------------------
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
              ELSE (SELECT count(*)::int FROM bulk_samples s WHERE s.deleted_at IS NULL AND lot_ref(s.sample_ref) = lot_ref(t.sample_ref)) END,
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
              ELSE (SELECT count(*)::int FROM forwarding_samples s WHERE s.deleted_at IS NULL AND lot_ref(s.sample_ref) = lot_ref(t.sample_ref)) END,
         (SELECT c.number FROM consignments c WHERE c.id = t.consignment_id)
    FROM forwarding_samples t;
