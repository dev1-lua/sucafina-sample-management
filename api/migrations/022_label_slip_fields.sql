-- 022: Gloria's sample slips (2026-09-11). A specialty label prints Stocklot · Outturn · Grower · Screen ·
--      Crop. Outturn (outturn), grower (name — the part before the "/"), screen (grade) and crop (crop_year)
--      already exist; the stock lot did not. Idempotent — deploy-api.sh re-applies every file on every deploy.
ALTER TABLE specialty_samples ADD COLUMN IF NOT EXISTS stocklot text;
COMMENT ON COLUMN specialty_samples.stocklot IS 'stock lot as printed on the sample slip, e.g. "15/5670" or "DS"';
