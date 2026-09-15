#!/usr/bin/env bash
# One-shot API deploy for round 9 (lifecycle sketch, 2026-09-14): archive HEAD, ship it to the VPS,
# run the standard deploy (idempotent migrations 011–022 + container rebuild), then verify.
# Run from anywhere:  bash scripts/deploy-api-round9.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/4 archive HEAD ($(git rev-parse --short HEAD))"
git archive --format=tar.gz -o sucafina-deploy.tar.gz HEAD

echo "== 2/4 rsync to the VPS"
rsync -avz sucafina-deploy.tar.gz root@156.67.105.74:~/ | tail -2

echo "== 3/4 deploy (migrations replay idempotently, containers rebuild)"
bash scripts/deploy-api.sh

echo "== 4/4 verify"
printf 'health: '; curl -s https://sucafina-api.luameet.in/health; echo
echo "awaiting_collection on the API (expect true/false per row, NOT n/a):"
npx tsx scripts/sandbox-qa-outbox.mts find "Beyers" | head -4

echo
echo "Done. Dashboard is already on Vercel (e45f6c2) and the agent is v61 — round 9 is fully live."
