#!/usr/bin/env bash
# One-shot API deploy for round 10 (refs name the coffee, orders, richer pings; 2026-09-22): archive HEAD,
# ship it to the VPS, run the standard deploy (idempotent migrations replay — 023 adds lots + order columns
# and backfills lots from live rows), then verify and show the lot-conflict dry run for QC's rename list.
# Run from anywhere:  bash scripts/deploy-api-round10.sh
# BEFORE running: take a DB backup on the VPS (see docs/HANDOVER-2026-09-22-round10.md §1).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/5 archive HEAD ($(git rev-parse --short HEAD))"
git archive --format=tar.gz -o sucafina-deploy.tar.gz HEAD

echo "== 2/5 rsync to the VPS"
rsync -avz sucafina-deploy.tar.gz root@156.67.105.74:~/ | tail -2

echo "== 3/5 deploy (migrations replay idempotently, containers rebuild)"
bash scripts/deploy-api.sh

echo "== 4/5 verify"
printf 'health: '; curl -s https://sucafina-api.luameet.in/health; echo
echo "lots endpoint (expect a JSON page, not 404):"
curl -s "https://sucafina-api.luameet.in/lots?book=commercial&pageSize=3" -H "x-api-key: ${API_KEY:?set API_KEY}" | head -c 600; echo

echo "== 5/5 lot conflicts (dry run — refs that name two different coffees, e.g. TYPE-113)"
echo "Run ON THE VPS inside the api container:  npx tsx scripts/lot-conflicts.ts        (dry run)"
echo "then, once QC has seen the list:            npx tsx scripts/lot-conflicts.ts --apply"

echo
echo "Done. Next: push main for Vercel (dashboard), then the agent version (see the handover)."
