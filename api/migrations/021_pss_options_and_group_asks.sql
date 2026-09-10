-- 021: Harriet's answers (2026-09-10) + the group-chat ask (the Beyers incident). Idempotent — deploy-api.sh
--      re-applies every file on every deploy. Every statement here either uses IF NOT EXISTS or is a
--      DROP-then-ADD of a constraint whose name Postgres generated (the only way to widen a CHECK).

-- 1. A missing-details ask can now be posted INTO the Teams group chat it was raised in (agent v56):
--    `via` gains 'group' next to 'teams' / 'email'.
ALTER TABLE client_detail_requests DROP CONSTRAINT IF EXISTS client_detail_requests_via_check;
ALTER TABLE client_detail_requests ADD CONSTRAINT client_detail_requests_via_check CHECK (via IN ('teams','email','group'));

-- 2. Harriet (2026-09-10): a PSS request is N lettered OPTIONS (A, B, C…) of X g each, per quality —
--    "CK wants 2 different PSS options (500 g per option)", "JDE wants a PSS per PO". The contract carries
--    the client's PO ref and the grams per option; each sample row carries its option letter. Refs are
--    contract-derived (SSKE-<contract digits><letter>, api/src/lib/contracts.ts pssRefFor) — the SSKE
--    counter stays only as a fallback for a contract number with no digits.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS po_ref text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS pss_qty_grams int CHECK (pss_qty_grams > 0);
ALTER TABLE bulk_samples ADD COLUMN IF NOT EXISTS option_letter text;
ALTER TABLE specialty_samples ADD COLUMN IF NOT EXISTS option_letter text;

-- 3. The second rejection flags the contract "PSS Replacement Rejected" (Harriet's words) AND draws again;
--    the old 'pss_rejected' value is renamed. The CHECK was inline in 020, so it is dropped by its
--    generated name and re-added; the UPDATE between them is a no-op once the rename has happened.
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_status_check;
UPDATE contracts SET status = 'pss_replacement_rejected' WHERE status = 'pss_rejected';
ALTER TABLE contracts ADD CONSTRAINT contracts_status_check
  CHECK (status IN ('open','pss_pending','pss_partial','pss_replacement_rejected','pss_approved','shipped','cancelled'));
COMMENT ON COLUMN contracts.pss_qty_grams IS 'grams per PSS option; NULL = default from the client''s last PSS, else 1 kg';
COMMENT ON COLUMN bulk_samples.option_letter IS 'PSS option letter (A, B, C…); container_no is the option slot it fills';

-- 4. One live option letter per contract per book: the auto-link picks the next letter OUTSIDE the
--    write transaction (POST /bulk-samples, POST /specialty-samples), so two PSS logged at the same
--    instant could both take "C". The partial index turns that race into a 409 (the error handler maps
--    23505) instead of two rows with one ref. The index is partial: a deleted option never blocks a letter
--    (letters themselves follow the ref rule — reused only when they were the highest in play).
CREATE UNIQUE INDEX IF NOT EXISTS bulk_samples_contract_option_idx
  ON bulk_samples (contract_id, option_letter) WHERE deleted_at IS NULL AND option_letter IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS specialty_samples_contract_option_idx
  ON specialty_samples (contract_id, option_letter) WHERE deleted_at IS NULL AND option_letter IS NOT NULL;
