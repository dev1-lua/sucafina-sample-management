#!/usr/bin/env bash
# Deploy the API to the Contabo VPS: apply migration 011, rebuild containers, run the Folgers data fix.
# Assumes sucafina-deploy.tar.gz has already been rsync'd to root@156.67.105.74:~/ and extracted
# (re-extracts anyway; harmless).
set -euo pipefail
HOST=root@156.67.105.74

ssh "$HOST" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/sucafina
tar xzf ~/sucafina-deploy.tar.gz
DC="docker compose -f docker-compose.prod.yml --env-file .env.prod"
echo "== migration 011"
$DC exec -T postgres psql -U sucafina sucafina < api/migrations/011_priority.sql
echo "== rebuild"
$DC up -d --build
$DC ps
echo "== Folgers data fix"
$DC exec -T postgres psql -U sucafina sucafina <<'SQL'
UPDATE client_contacts SET full_address='1 Riverfront Drive, Brooklyn, 1201' WHERE id='d66adca5-9877-49bd-acd1-877885e9593c';
DELETE FROM client_contacts WHERE id='4316e93e-4b30-4939-b869-309097035e76';
UPDATE clients SET country='USA' WHERE id='2fb40987-cd70-42a8-a981-87cbbd43767f';
SELECT c.name, c.country, cc.attention_to, cc.full_address, cc.phone FROM clients c JOIN client_contacts cc ON cc.client_id=c.id WHERE c.id='2fb40987-cd70-42a8-a981-87cbbd43767f';
SQL
echo "== health"
sleep 3
curl -s http://localhost:4000/health || true
REMOTE
