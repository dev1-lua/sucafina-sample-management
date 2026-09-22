#!/usr/bin/env bash
# Round 10 in one go (2026-09-22): API to the VPS (backup + migrations 011–023 + rebuild), lot-conflict
# dry run, optional apply, then push main so Vercel builds the dashboard.
# The agent (lua compile/push/version/promote) is NOT here — run those yourself, see the handover §3.
# Run from anywhere:  bash scripts/deploy-round10.sh
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=root@156.67.105.74
DC='docker compose -f docker-compose.prod.yml --env-file .env.prod'

echo "== 1/5 archive HEAD ($(git rev-parse --short HEAD)) + rsync"
git archive --format=tar.gz -o sucafina-deploy.tar.gz HEAD
rsync -avz sucafina-deploy.tar.gz "$HOST":~/ | tail -1

echo "== 2/5 API deploy (backup, migrations 011–023, rebuild)"
bash scripts/deploy-api.sh

echo "== 3/5 verify"
KEY="${API_KEY:-$(grep '^API_KEY=' .env.prod 2>/dev/null | cut -d= -f2-)}"
printf 'health: '; curl -s https://sucafina-api.luameet.in/health; echo
printf 'lots:   '; curl -s "https://sucafina-api.luameet.in/lots?book=commercial&pageSize=1" -H "x-api-key: ${KEY}" | head -c 300; echo
printf 'resolve: '; curl -s "https://sucafina-api.luameet.in/samples/resolve?ref=TYPE-113" -H "x-api-key: ${KEY}" | head -c 300; echo

echo "== 4/5 lot conflicts — refs that name two different coffees (dry run)"
ssh "$HOST" "cd /opt/sucafina && $DC exec -T api npx tsx scripts/lot-conflicts.ts < /dev/null"
echo
read -r -p "Apply the re-issue above (every non-oldest row gets a fresh ref, QC gets a change alert)? [y/N] " yn
if [[ "${yn:-N}" =~ ^[Yy]$ ]]; then
  ssh "$HOST" "cd /opt/sucafina && $DC exec -T api npx tsx scripts/lot-conflicts.ts --apply < /dev/null"
else
  echo "skipped — run later: ssh $HOST \"cd /opt/sucafina && $DC exec -T api npx tsx scripts/lot-conflicts.ts --apply < /dev/null\""
fi

echo "== 5/5 dashboard → Vercel (git push origin main)"
git push origin main

echo
echo "Done: API + dashboard. Now the agent, yourself:"
echo "  lua compile --ci && lua push all && lua version create && lua version diff v77 v78   # then: lua version promote v78"
