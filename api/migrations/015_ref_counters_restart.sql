-- Brillian (2026-08-26): offer samples continue from SL-7459 and type samples from TYPE-108,
-- picking up where the desk's own numbering left off (the Sample Chaser sheet ended at SL-7448 /
-- TYPE-974; the rows issued as SL-80xx / TYPE-10xx since July keep their refs — no renumbering).
-- Format stays unpadded ("SL-7459", not "SL-07459").
--
-- ONE-SHOT: deploy-api.sh re-applies migration files on every deploy, so the reset is guarded by a
-- marker row. issueRef only ever reads its own prefix, so the marker is inert. Re-running is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ref_counters WHERE prefix = '_restart_2026_08') THEN
    UPDATE ref_counters SET next_val = 7459 WHERE prefix = 'SL';
    UPDATE ref_counters SET next_val = 108  WHERE prefix = 'TYPE';
    INSERT INTO ref_counters (prefix, next_val) VALUES ('_restart_2026_08', 0);
  END IF;
END $$;
