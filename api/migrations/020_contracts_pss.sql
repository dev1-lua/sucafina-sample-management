-- 020: Contracts + pre-shipment samples (Harriet, round 6: "PSS must be sent 45 days before shipment; feed
--      the PSS table from the SOL report; nest samples per contract into number of PSS and containers;
--      client can reject one out of X"). pss_due_date is computed, never typed. Idempotent.
CREATE TABLE IF NOT EXISTS pss_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_url text NOT NULL, file_name text, format text, sheet text,
  mapping jsonb, rows jsonb NOT NULL DEFAULT '[]'::jsonb, summary jsonb,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','committed','discarded')),
  actor text, committed_at timestamptz,
  deleted_at timestamptz,   -- never set; present because POST /notifications/outbox-mark filters `AND deleted_at IS NULL` on every tab's table
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number text NOT NULL,
  client_id uuid REFERENCES clients(id), client_name text,
  quality text, destination text,
  shipment_date date, shipment_month text,
  containers int NOT NULL DEFAULT 1 CHECK (containers >= 1),
  pss_expected int NOT NULL DEFAULT 1 CHECK (pss_expected >= 1),
  pss_due_date date GENERATED ALWAYS AS (shipment_date - 45) STORED,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pss_pending','pss_partial','pss_rejected','pss_approved','shipped','cancelled')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('sol_import','manual')),
  import_id uuid REFERENCES pss_imports(id),
  notes text, deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS contracts_number_live_idx ON contracts (upper(trim(contract_number))) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS contracts_due_idx ON contracts (pss_due_date) WHERE deleted_at IS NULL;
ALTER TABLE specialty_samples ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES contracts(id);
ALTER TABLE specialty_samples ADD COLUMN IF NOT EXISTS container_no int;
ALTER TABLE specialty_samples ADD COLUMN IF NOT EXISTS replaces_sample_id uuid;
ALTER TABLE bulk_samples ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES contracts(id);
ALTER TABLE bulk_samples ADD COLUMN IF NOT EXISTS container_no int;
ALTER TABLE bulk_samples ADD COLUMN IF NOT EXISTS replaces_sample_id uuid;
CREATE INDEX IF NOT EXISTS bulk_samples_contract_idx ON bulk_samples (contract_id, container_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS specialty_samples_contract_idx ON specialty_samples (contract_id, container_no) WHERE deleted_at IS NULL;
-- PG 12+ allows ADD VALUE inside a transaction; the values are only added here, never used in this file.
ALTER TYPE entity_type_scope ADD VALUE IF NOT EXISTS 'contract';
ALTER TYPE entity_type_scope ADD VALUE IF NOT EXISTS 'import';
