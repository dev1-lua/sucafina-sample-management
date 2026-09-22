#!/usr/bin/env bash
# Round 10b in one go (2026-09-23, Harriet's two asks): API to the VPS (backup + migrations 011–024 + rebuild),
# smoke checks, orders backfill (dry run, then apply on a y), a FRESH lot-conflicts dry run (read-only), then push
# main so Vercel builds the dashboard. The agent (lua compile/push/version/promote) is NOT here — run those
# yourself, see docs/HANDOVER-2026-09-23-pss-groups.md §3.
# Run from anywhere:  bash scripts/deploy-api-round10b.sh
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=root@156.67.105.74
DC='docker compose -f docker-compose.prod.yml --env-file .env.prod'

echo "== 1/6 archive HEAD ($(git rev-parse --short HEAD)) + rsync"
git archive --format=tar.gz -o sucafina-deploy.tar.gz HEAD
rsync -avz sucafina-deploy.tar.gz "$HOST":~/ | tail -1

echo "== 2/6 API deploy (pg_dump backup, migrations 011–024 replay, rebuild)"
bash scripts/deploy-api.sh

echo "== 3/6 verify"
KEY="${API_KEY:-$(grep '^API_KEY=' .env.prod 2>/dev/null | cut -d= -f2-)}"
printf 'health:      '; curl -s https://sucafina-api.luameet.in/health; echo
printf 'lots (comm): '; curl -s "https://sucafina-api.luameet.in/lots?book=commercial&pageSize=1" -H "x-api-key: ${KEY}" | head -c 300; echo
printf 'SSKE group:  '; curl -s "https://sucafina-api.luameet.in/lots?book=commercial&q=SSKE-&pageSize=1" -H "x-api-key: ${KEY}" | head -c 400; echo
printf 'resolve:     '; curl -s "https://sucafina-api.luameet.in/samples/resolve?ref=TYPE-113" -H "x-api-key: ${KEY}" | head -c 300; echo
echo "(expect the SSKE group row to carry \"options\":[...] and no lettered SSKE ref as a lot)"

SINCE="${BACKFILL_SINCE:-2026-08-01}"
echo "== 4/6 orders backfill — rows since $SINCE that share client + AWB and have no order yet (dry run; BACKFILL_SINCE=… to change)"
ssh "$HOST" "cd /opt/sucafina && $DC exec -T api npx tsx scripts/backfill-orders.ts --since $SINCE < /dev/null"
echo
read -r -p "Create these orders (one consignment per client+AWB group, notes 'backfilled from AWB …')? [y/N] " yn
if [[ "${yn:-N}" =~ ^[Yy]$ ]]; then
  ssh "$HOST" "cd /opt/sucafina && $DC exec -T api npx tsx scripts/backfill-orders.ts --since $SINCE --apply < /dev/null"
else
  echo "skipped — run later: ssh $HOST \"cd /opt/sucafina && $DC exec -T api npx tsx scripts/backfill-orders.ts --since $SINCE --apply < /dev/null\""
fi

echo "== 5/6 lot conflicts — FRESH dry run with the softer quality match (read-only; never --apply from here)"
ssh "$HOST" "cd /opt/sucafina && $DC exec -T api npx tsx scripts/lot-conflicts.ts < /dev/null" | head -80
echo
echo "Apply only named refs after QC has seen them, e.g.:"
echo "  ssh $HOST \"cd /opt/sucafina && $DC exec -T api npx tsx scripts/lot-conflicts.ts --ref TYPE-1234,SL-5678 --apply < /dev/null\""

echo "== 6/6 dashboard → Vercel (git push origin main)"
git push origin main

echo
echo "Done: API + dashboard. Now the agent, yourself (promote ONLY after the diff looks right):"
echo "  lua compile --ci && lua push all --force && lua version create && lua version diff v86 <new>"
echo "  lua version promote <new>"
