-- 016: LOG FIRST, COMPLETE LATER (Beyers, 2026-09-08 — Ivo Jr.: "the goal is not for you to hard block me
--      because you're missing an address… I just get the request and send it to you. Then you chase people
--      down for the details you need.")
--
-- Before this migration the agent refused to write a sample until the client had a street address on file
-- (the 24-Jul Folgers gate). A sample is now written the moment the coffee, type, qty and receiver are known;
-- the missing client details become a recorded ASK (who was asked, when, how) that the desk chases every
-- morning, and the gap is loud on every read (lists, GET, search, QC's new-request ping).
--
-- client_address_missing(uuid) — the ONE definition of "nowhere to send it": an external client is linked
--   and none of its contacts carries a street address. Internal Sucafina/Kenyacof offices never count.
--   NULL client_id → false (dashboard/legacy rows without a client link must not light up).
-- client_detail_requests — one OPEN ask per client (partial unique index). The address is a property of the
--   client, so three samples for Beyers = one ask to Tommie, resolved once when the address lands.
--
-- Every statement is idempotent; the new enum values are only ADDED here, never used in this file.

CREATE OR REPLACE FUNCTION client_address_missing(cid uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT cid IS NOT NULL
     AND EXISTS (SELECT 1 FROM clients c
                  WHERE c.id = cid AND c.deleted_at IS NULL
                    AND c.name !~* '\m(sucafina|kenyacof)\M')
     AND NOT EXISTS (SELECT 1 FROM client_contacts cc
                      WHERE cc.client_id = cid
                        AND coalesce(trim(cc.full_address), '') <> '')
$$;

CREATE TABLE IF NOT EXISTS client_detail_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES clients(id),
  missing          text[] NOT NULL,                 -- e.g. {'full street address','contact person','phone'}
  asked_name       text,                            -- who was asked (NULL = nobody yet; the chaser nudges the logger)
  asked_email      text,
  asked_trader_id  uuid REFERENCES traders(id),
  asked_by         text,                            -- the person who logged the sample (name)
  asked_by_email   text,                            -- CC on every chase
  note             text,                            -- the trader's own words: "the lab has the address"
  via              text CHECK (via IN ('teams','email')),  -- NULL until a delivery succeeds
  asked_at         timestamptz NOT NULL DEFAULT now(),
  delivered_at     timestamptz,
  last_chased_at   timestamptz,
  chase_count      int NOT NULL DEFAULT 0,
  escalated_at     timestamptz,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS client_detail_requests_open_idx
  ON client_detail_requests (client_id) WHERE resolved_at IS NULL;

-- Timeline verbs (never used in this file — ADD VALUE + use in one run is illegal).
ALTER TYPE entity_event_t ADD VALUE IF NOT EXISTS 'details_requested';
ALTER TYPE entity_event_t ADD VALUE IF NOT EXISTS 'details_chased';
ALTER TYPE entity_event_t ADD VALUE IF NOT EXISTS 'details_resolved';

-- Recreate the cross-table read view: same 29 columns/order as migration 013, plus cols 30–32:
-- client_address_missing, details_requested_from, details_requested_at (correlated on the OPEN ask).
-- The subqueries reference t.client_id explicitly — a bare client_id would bind to r.client_id.
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
         (SELECT r.asked_at   FROM client_detail_requests r WHERE r.client_id = t.client_id AND r.resolved_at IS NULL) AS details_requested_at
    FROM specialty_samples t
  UNION ALL
  SELECT 'bulk', t.id, t.sample_ref, t.quality, t.client, t.country, t.client_id, t.status,
         t.courier_norm, t.awb, t.qty_grams, t.date_on, t.delivery_on, t.result_norm,
         t.created_at, t.deleted_at, t.sample_type_norm, t.phyto_cert,
         t.blend, t.strategy, t.highlights, t.result_on,
         t.location, t.requested_by, t.completed_by, t.stock_grams, t.dispatched_on, t.priority, t.logged_by,
         client_address_missing(t.client_id),
         (SELECT r.asked_name FROM client_detail_requests r WHERE r.client_id = t.client_id AND r.resolved_at IS NULL),
         (SELECT r.asked_at   FROM client_detail_requests r WHERE r.client_id = t.client_id AND r.resolved_at IS NULL)
    FROM bulk_samples t
  UNION ALL
  SELECT 'forwarding', t.id, t.sample_ref, t.coffee_quality, t.receiver_company, t.origin,
         t.client_id, t.status, t.courier_norm, t.awb, t.qty_grams, t.date_on,
         NULL::date, NULL::result_t, t.created_at, t.deleted_at, NULL::text, t.phyto_cert,
         NULL::text, NULL::text, NULL::text, NULL::date,
         t.location, t.requested_by, t.completed_by, t.stock_grams, t.dispatched_on, t.priority, t.logged_by,
         client_address_missing(t.client_id),
         (SELECT r.asked_name FROM client_detail_requests r WHERE r.client_id = t.client_id AND r.resolved_at IS NULL),
         (SELECT r.asked_at   FROM client_detail_requests r WHERE r.client_id = t.client_id AND r.resolved_at IS NULL)
    FROM forwarding_samples t;
