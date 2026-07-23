-- 006: Commercial (bulk) sample references.
--
-- Feedback ⑱: a Commercial sample surfaced in the chaser showed up as "(no ref)" because
-- POST /bulk-samples never issued a reference (only Specialty + the legacy `samples` table
-- called issueRef). With nothing to quote, Chat couldn't resolve the sample when asked about it.
--
-- Going forward the route now auto-issues a ref (api/src/routes/bulk-samples.ts) using the same
-- prefix mapping as everywhere else (pss→SSKE, type→TYPE, else→SL). This migration backfills a ref
-- for every existing null-ref Commercial row so historical rows are citable too. On a fresh DB
-- (tests) there are no rows, so it is a no-op.
--
-- For each prefix we reserve a contiguous block from ref_counters (bump next_val by the row count),
-- then assign sequential numbers ordered by created_at so the oldest rows get the lowest numbers.
DO $$
DECLARE
  pfx text;
  n int;
  start_val int;
BEGIN
  FOREACH pfx IN ARRAY ARRAY['SSKE','TYPE','SL'] LOOP
    SELECT count(*) INTO n
      FROM bulk_samples b
     WHERE (b.sample_ref IS NULL OR b.sample_ref = '')
       AND b.deleted_at IS NULL
       AND (CASE WHEN b.sample_type_norm = 'pss'  THEN 'SSKE'
                 WHEN b.sample_type_norm = 'type' THEN 'TYPE'
                 ELSE 'SL' END) = pfx;

    IF n > 0 THEN
      UPDATE ref_counters SET next_val = next_val + n
       WHERE prefix = pfx
       RETURNING next_val - n INTO start_val;

      WITH ordered AS (
        SELECT b.id, row_number() OVER (ORDER BY b.created_at, b.id) - 1 AS rn
          FROM bulk_samples b
         WHERE (b.sample_ref IS NULL OR b.sample_ref = '')
           AND b.deleted_at IS NULL
           AND (CASE WHEN b.sample_type_norm = 'pss'  THEN 'SSKE'
                     WHEN b.sample_type_norm = 'type' THEN 'TYPE'
                     ELSE 'SL' END) = pfx
      )
      UPDATE bulk_samples t
         SET sample_ref = pfx || '-' || (start_val + o.rn)
        FROM ordered o
       WHERE t.id = o.id;
    END IF;
  END LOOP;
END $$;
