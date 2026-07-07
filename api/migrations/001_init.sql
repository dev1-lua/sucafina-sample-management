CREATE TYPE sample_type_t AS ENUM
  ('offer','type','pss','woc','retention','flavor_mapping','marketing','calibration','other');
CREATE TYPE sample_status_t AS ENUM
  ('requested','preparing','dispatched','delivered','results_in','cancelled');
CREATE TYPE courier_t AS ENUM
  ('dhl','fedex','ups','rider','hand_delivery','client_pickup','other');
CREATE TYPE result_t AS ENUM ('approved','rejected','pending_feedback');
CREATE TYPE event_type_t AS ENUM
  ('requested','status_change','dispatched','delivery_update','result_logged','chased','note','edited');

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  country text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clients_name_lower_idx ON clients ((lower(name)));

CREATE TABLE client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  attention_to text,
  full_address text,
  phone text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref text,
  ref_raw text,
  source_sheet text NOT NULL DEFAULT 'agent',
  sample_type sample_type_t NOT NULL DEFAULT 'other',
  shipment_month text,
  quality text,
  grade text,
  outturn text,
  mark_name text,
  ico_mark text,
  client_ref text,
  bags integer,
  qty_grams integer,
  qty_raw text,
  moisture text,
  water_activity text,
  client_id uuid REFERENCES clients(id),
  receiver text,
  requester text,
  deadline date,
  roast_instructions text,
  status sample_status_t NOT NULL DEFAULT 'requested',
  courier courier_t,
  courier_raw text,
  awb text,
  requested_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  result result_t,
  cupping_notes text,
  comments text,
  crop_year text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX samples_ref_idx ON samples (ref);
CREATE INDEX samples_status_idx ON samples (status);
CREATE INDEX samples_client_idx ON samples (client_id);
CREATE INDEX samples_awb_idx ON samples (awb);

CREATE TABLE sample_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id uuid NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
  type event_type_t NOT NULL,
  note text,
  actor text NOT NULL DEFAULT 'api',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sample_events_sample_idx ON sample_events (sample_id, created_at);

CREATE TABLE ref_counters (
  prefix text PRIMARY KEY,
  next_val integer NOT NULL
);
INSERT INTO ref_counters (prefix, next_val) VALUES ('SL', 8000), ('TYPE', 1000), ('SSKE', 108000);

CREATE TABLE chaser_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
