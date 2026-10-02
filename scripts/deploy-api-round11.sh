#!/usr/bin/env bash
# Round 11 in one go (2026-10-02, 28 Sep call: Send IDs, QC-editable refs, Clients view): API to the VPS
# (pg_dump backup + migrations 011–025 replay + rebuild), then smoke checks incl. the 025 backfill counts.
# The dashboard was pushed to main already (Vercel builds it). The agent (lua compile/push/version/promote)
# is NOT here — run those yourself, see docs/HANDOVER-2026-09-29-send-id-clients-view.md §3.
# Run from anywhere:  bash scripts/deploy-api-round11.sh
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=root@156.67.105.74
DC='docker compose -f docker-compose.prod.yml --env-file .env.prod'

echo "== 1/3 archive HEAD ($(git rev-parse --short HEAD)) + rsync"
git archive --format=tar.gz -o sucafina-deploy.tar.gz HEAD
rsync -avz sucafina-deploy.tar.gz "$HOST":~/ | tail -1

echo "== 2/3 API deploy (pg_dump backup, migrations 011–025 replay, rebuild)"
bash scripts/deploy-api.sh

echo "== 3/3 verify"
KEY="${API_KEY:-$(grep '^API_KEY=' .env.prod 2>/dev/null | cut -d= -f2-)}"
printf 'health:        '; curl -s https://sucafina-api.luameet.in/health; echo
printf 'search SS-1000: '; curl -s "https://sucafina-api.luameet.in/search?q=SS-1000&pageSize=1" -H "x-api-key: ${KEY}" | head -c 300; echo
printf 'clients view:  '; curl -s "https://sucafina-api.luameet.in/client-sends?book=specialty&pageSize=2" -H "x-api-key: ${KEY}" | head -c 400; echo
printf 'lots by SS id: '; curl -s "https://sucafina-api.luameet.in/lots?book=specialty&q=SS-1000&pageSize=1" -H "x-api-key: ${KEY}" | head -c 300; echo
echo "-- 025 backfill: first line must be 0, second line must show two equal numbers"
ssh "$HOST" "cd /opt/sucafina && $DC exec -T postgres psql -U sucafina sucafina -At -c \"SELECT count(*) FROM all_samples_v WHERE send_id IS NULL\" -c \"SELECT count(DISTINCT send_id) || ' ' || count(*) FROM all_samples_v\" < /dev/null"

echo
echo "Done: API. Dashboard is on Vercel from main. Now the agent, yourself (promote ONLY after the diff looks right):"
echo "  lua compile --ci && lua push all --force && lua version create && lua version diff v94 <new>"
echo "  lua version promote <new>"
