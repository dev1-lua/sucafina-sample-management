#!/usr/bin/env bash
# Deploy the API to the Contabo VPS: apply migrations 011–013 (all idempotent), rebuild containers.
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
