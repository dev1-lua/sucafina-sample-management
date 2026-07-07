-- 002_three_tables.sql
-- Three dedicated sample tables (one per workbook sheet), a polymorphic event
-- log, traders + clients.account_owner_id, soft-delete columns, and a
-- cross-table read view. Legacy samples/sample_events (001) are left untouched.

-- ---- enums ------------------------------------------------------------
CREATE TYPE entity_type_scope AS ENUM ('specialty','bulk','forwarding','client');
CREATE TYPE entity_event_t AS ENUM
  ('created','edited','status_change','dispatched','delivery_update',
   'result_logged','chased','note','deleted','restored');

-- ---- traders + clients additions -------------------------------------
CREATE TABLE traders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  email text,
  role text NOT NULL DEFAULT 'trader' CHECK (role IN ('trader','qc')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE clients ADD COLUMN account_owner_id uuid REFERENCES traders(id);
ALTER TABLE clients ADD COLUMN deleted_at timestamptz;

-- ---- specialty_samples (Sample tab) ----------------------------------
CREATE TABLE specialty_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- source columns (verbatim, display order)
  date text, ref text, outturn text, name text, grade text, bags integer,
  description text, receiver_company text, awb text, courier text, qty text,
  delivery_date text, result text, comments text, crop_year text, crop_area_details text,
  -- typed companions (sort/filter only)
  date_on date, delivery_on date, qty_grams integer,
  courier_norm courier_t, result_norm result_t, sample_type_norm sample_type_t,
  -- system
  client_id uuid REFERENCES clients(id),
  status sample_status_t NOT NULL DEFAULT 'requested',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX specialty_status_idx ON specialty_samples (status);
CREATE INDEX specialty_client_idx ON specialty_samples (client_id);
CREATE INDEX specialty_date_idx   ON specialty_samples (date_on);
CREATE INDEX specialty_awb_idx    ON specialty_samples (awb);

-- ---- bulk_samples (Bulk tab) -----------------------------------------
CREATE TABLE bulk_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- source columns (verbatim, display order)
  date text, sample_ref text, bags integer, quality text, client_ref text,
  ico_mark text, sample_type text, client text, country text, awb text,
  courier text, qty text, moisture text, water_activity text, delivery_date text,
  result text, comments text, crop_year text, crop_area_details text,
  -- typed companions (sort/filter only)
  date_on date, delivery_on date, qty_grams integer,
  courier_norm courier_t, result_norm result_t, sample_type_norm sample_type_t,
  moisture_pct numeric, water_activity_num numeric,
  -- system
  client_id uuid REFERENCES clients(id),
  status sample_status_t NOT NULL DEFAULT 'requested',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bulk_status_idx ON bulk_samples (status);
CREATE INDEX bulk_client_idx ON bulk_samples (client_id);
CREATE INDEX bulk_date_idx   ON bulk_samples (date_on);
CREATE INDEX bulk_awb_idx    ON bulk_samples (awb);

-- ---- forwarding_samples (Forwarding tab) -----------------------------
CREATE TABLE forwarding_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- source columns (verbatim, display order) — one row per ID Number
  date text, sender text, origin text, sample_ref text, coffee_quality text,
  receiver_company text, id_number text, awb text, courier text, qty text,
  -- typed companions (sort/filter only)
  date_on date, qty_grams integer, courier_norm courier_t,
  -- system (reduced lifecycle: never results_in)
  client_id uuid REFERENCES clients(id),
  status sample_status_t NOT NULL DEFAULT 'requested',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forwarding_status_idx ON forwarding_samples (status);
CREATE INDEX forwarding_client_idx ON forwarding_samples (client_id);
CREATE INDEX forwarding_date_idx   ON forwarding_samples (date_on);
CREATE INDEX forwarding_awb_idx    ON forwarding_samples (awb);

-- ---- polymorphic event log (legacy sample_events untouched) ----------
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type entity_type_scope NOT NULL,
  entity_id uuid NOT NULL,
  type entity_event_t NOT NULL,
  note text,
  actor text NOT NULL DEFAULT 'api',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_entity_idx ON events (entity_type, entity_id, created_at);

-- ---- cross-table read view -------------------------------------------
CREATE VIEW all_samples_v AS
  SELECT 'specialty'::text AS tab, id, ref AS ref, description AS title,
         receiver_company AS receiver, NULL::text AS country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at
    FROM specialty_samples
  UNION ALL
  SELECT 'bulk', id, sample_ref, quality, client, country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at
    FROM bulk_samples
  UNION ALL
  SELECT 'forwarding', id, sample_ref, coffee_quality, receiver_company, origin,
         client_id, status, courier_norm, awb, qty_grams, date_on,
         NULL::date, NULL::result_t, created_at, deleted_at
    FROM forwarding_samples;
