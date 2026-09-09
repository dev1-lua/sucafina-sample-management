#!/usr/bin/env bash
# Deploy the API to the Contabo VPS: apply migrations 011–019 (all idempotent / one-shot guarded), rebuild containers.
# Assumes sucafina-deploy.tar.gz has already been rsync'd to root@156.67.105.74:~/ and extracted
# (re-extracts anyway; harmless).
#
# Round-4 one-off Folgers data fix (contact address / country) was applied on 2026-08-18 and removed
# from this script. Merge of "Paulig" → "Gustav Paulig Ltd (NEW) Jan 23" (feedback #27) is NOT run here:
# it goes through POST /clients/:id/merge after deploy, on the user's explicit go.
set -euo pipefail
HOST=root@156.67.105.74

ssh "$HOST" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/sucafina
tar xzf ~/sucafina-deploy.tar.gz
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
echo "== migration 011 (idempotent)"
$DC exec -T postgres psql -U sucafina sucafina < api/migrations/011_priority.sql
echo "== migration 012 (client merge event types)"
$DC exec -T postgres psql -U sucafina sucafina < api/migrations/012_client_merge_events.sql
echo "== migration 013 (logged_by + notifications outbox)"
$DC exec -T postgres psql -U sucafina sucafina < api/migrations/013_logged_by_and_outbox.sql
echo "== migration 014 (keep-in-the-loop contacts)"
$DC exec -T postgres psql -U sucafina sucafina < api/migrations/014_loop_in_contacts.sql
echo "== migration 015 (ref counters restart: SL-7459 / TYPE-108, one-shot)"
$DC exec -T postgres psql -U sucafina sucafina < api/migrations/015_ref_counters_restart.sql
echo "== migration 016 (log first: client_address_missing() + client_detail_requests + view)"
$DC exec -T postgres psql -U sucafina sucafina < api/migrations/016_log_first_detail_requests.sql
echo "== migration 017 (outbox change alerts: wider tabs, dedupe_key/payload/actor)"
$DC exec -T postgres psql -U sucafina sucafina < api/migrations/017_outbox_change_alerts.sql
echo "== migration 018 (legacy samples soft delete: deleted_at + event_type_t deleted/restored)"
$DC exec -T postgres psql -U sucafina sucafina < api/migrations/018_legacy_samples_soft_delete.sql
echo "== migration 019 (courier tracking columns + sweep index)"
$DC exec -T postgres psql -U sucafina sucafina < api/migrations/019_tracking.sql
echo "== rebuild"
$DC up -d --build
$DC ps
echo "== health"
sleep 3
curl -s http://localhost:4000/health || true
echo
echo "== merge-candidates smoke (Paulig)"
curl -s -H "x-api-key: $(grep '^API_KEY=' .env.prod | cut -d= -f2-)" \
  http://localhost:4000/clients/d8328a5f-dbe3-4c46-9637-9177f8d6fdad/merge-candidates || true
echo
REMOTE
