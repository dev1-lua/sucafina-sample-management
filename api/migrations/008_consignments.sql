-- 008: Consignments (feedback ⑥⑦⑧ — Muki).
--
-- A consignment groups several samples that ship out together, carries a generated reference
-- number, and is assigned to a lab location (Westlands / Thika). Each sample may belong to at
-- most one consignment (nullable FK), so grouping is opt-in and existing rows are unaffected.

-- Audit scope: consignments log through the same polymorphic `events` table as samples/clients.
-- PG 12+ allows ADD VALUE inside a transaction; the value isn't *used* in this migration (only
-- added), so there's no "unsafe use of new value" issue. IF NOT EXISTS keeps re-runs safe.
ALTER TYPE entity_type_scope ADD VALUE IF NOT EXISTS 'consignment';

-- Consignment-number counter, mirroring SL/TYPE/SSKE (migration 001). Minted by lib/refs.ts.
INSERT INTO ref_counters (prefix, next_val) VALUES ('CN', 1000)
  ON CONFLICT (prefix) DO NOTHING;

CREATE TABLE consignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,             -- minted, e.g. "CN-1000"
  location text,                           -- lab it ships from / sits at (Westlands / Thika); free text
  status text NOT NULL DEFAULT 'open',     -- open | dispatched | closed
  notes text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Each sample belongs to at most one consignment.
ALTER TABLE specialty_samples  ADD COLUMN consignment_id uuid REFERENCES consignments(id);
ALTER TABLE bulk_samples       ADD COLUMN consignment_id uuid REFERENCES consignments(id);
ALTER TABLE forwarding_samples ADD COLUMN consignment_id uuid REFERENCES consignments(id);
CREATE INDEX specialty_consignment_idx  ON specialty_samples  (consignment_id);
CREATE INDEX bulk_consignment_idx       ON bulk_samples       (consignment_id);
CREATE INDEX forwarding_consignment_idx ON forwarding_samples (consignment_id);
