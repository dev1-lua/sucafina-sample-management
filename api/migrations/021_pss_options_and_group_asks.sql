-- 021: Harriet's answers (2026-09-10) + the group-chat ask (the Beyers incident). Idempotent — deploy-api.sh
--      re-applies every file on every deploy. Every statement here either uses IF NOT EXISTS or is a
--      DROP-then-ADD of a constraint whose name Postgres generated (the only way to widen a CHECK).

-- 1. A missing-details ask can now be posted INTO the Teams group chat it was raised in (agent v56):
--    `via` gains 'group' next to 'teams' / 'email'.
ALTER TABLE client_detail_requests DROP CONSTRAINT IF EXISTS client_detail_requests_via_check;
ALTER TABLE client_detail_requests ADD CONSTRAINT client_detail_requests_via_check CHECK (via IN ('teams','email','group'));
