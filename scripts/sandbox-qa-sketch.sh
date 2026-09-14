#!/bin/zsh
# Sandbox conversation QA for the lifecycle sketch (2026-09-14). `lua chat -e sandbox` compiles the
# local tree and pushes skills + preprocessors to the sandbox itself (no `lua push` needed), but it
# also rewrites lua.skill.yaml versions to the server's — re-check the bumps before `lua push`.
# Rows are written to the PROD API (repo .env): pings are silenced and the rows deleted at the end.
# Run from the repo root: npm run qa:sketch
set -u
cd "$(dirname "$0")/.." || exit 1
STAMP=$(date +%H%M%S)
CLIENT="QA Sketch Roasters ${STAMP}"
A="qa-sketch-a-${STAMP}"
B="qa-sketch-b-${STAMP}"
say() { printf '\n\033[1m>>> %s\033[0m\n' "$1"; }
turn() { npx lua chat -e sandbox -t "$1" -m "$2" 2>&1 | sed -n '/Response:/,$p' | grep -v '│\|╭\|╰\|^Thread:\|^──\|Response:'; }
silence() { npx tsx scripts/sandbox-qa-outbox.mts silence "$CLIENT"; }

say "A1 trader asks, unknown client → expect ONE line asking the address (qty default offered)"
turn "$A" "Ivo wants an AB FAQ type sample sent to ${CLIENT} in Antwerp, Belgium"
say "A2 skip → expect no second address question (a phyto question for abroad is fine)"
turn "$A" "skip"
say "A3 phyto answer → expect the echo with Sales Trader: Ivo • Deliver to: ⚠ no address yet"
turn "$A" "no"
say "A4 confirm → expect the card with ⚠ address pending + 'QC will get a ping … AWB' line"
turn "$A" "yes"
silence
say "A5 loop-in question (only while Ivo has no email on the roster) → skip"
turn "$A" "skip"
say "A6 status → expect requested + address pending"
turn "$A" "where is the ${CLIENT} type sample?"

say "B1 PSS, no usual size, address now still missing → expect address AND quantity in ONE line"
turn "$B" "Ivo wants a PSS sent to ${CLIENT} for the June shipment, contract 104999"
say "B2 answer both → expect phyto question or straight to the echo with Deliver to: <address>"
turn "$B" "contract number is right, log it anyway. Address is Kammenstraat 12, 2000 Antwerp, Belgium. 500g please"
turn "$B" "no phyto"
say "B3 confirm → expect SSKE ref, no ⚠, address saved on the client"
turn "$B" "yes"
silence

say "rows written (address_missing should be false on both):"
npx tsx scripts/sandbox-qa-outbox.mts find "$CLIENT"
say "cleanup"
npx tsx scripts/sandbox-qa-outbox.mts cleanup "$CLIENT"
silence
npx tsx scripts/sandbox-qa-outbox.mts outbox "$CLIENT"
say "done — now re-check lua.skill.yaml versions (lua chat resets them) before lua push"
