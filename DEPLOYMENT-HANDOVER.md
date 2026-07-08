# Deployment Handover — Sucafina Sample-Chaser

Live production system, deployed 2026-07-08. Three tiers: **Frontend (Vercel)** · **Backend API + Postgres (Contabo VPS)** · **Conversational Agent (Lua platform)**.

> Secrets are **not** in this file. They live in three places (see §5) — generated fresh at deploy time.

---

## 0. At a glance

| Tier | Where | Public entry point |
|------|-------|--------------------|
| Frontend | Vercel (project root `dashboard-v2`) | your `*.vercel.app` URL (or a custom domain) |
| Backend API | Contabo VPS `156.67.105.74`, `/opt/sucafina`, Docker | `https://sucafina-api.luameet.in` |
| Postgres | same VPS, Docker volume `sucafina_pgdata` (private, not published) | — (internal only) |
| Agent | Lua platform, agent `baseAgent_agent_1783420556773_cc6qh9f2y` | production, version **v2** |

Quick health check:
```
curl https://sucafina-api.luameet.in/health          # {"ok":true}
lua chat -e production -m "how many samples are awaiting results?"
```

---

## 1. Frontend (Vercel)
- **Source:** `dashboard-v2/` (Vite + React SPA). Config in `dashboard-v2/vercel.json` (build `npm run build`, output `dist`, SPA rewrite so deep links like `/clients/:id` work).
- **Deployed via CLI** (no git remote): `cd dashboard-v2 && npx vercel --prod`.
- **Env vars** (set in Vercel for Production + Preview + Development):
  - `VITE_API_BASE = https://sucafina-api.luameet.in`
  - `VITE_API_KEY  = <the API key from §5>`  ← embedded in the client bundle; a gate, not a secret.
- **Redeploy:** re-run `npx vercel --prod` from `dashboard-v2/`, or connect the repo to Vercel git for auto-deploys once a remote exists.

## 2. Backend API + Postgres (Contabo VPS)
- **Host:** `root@156.67.105.74`, app dir **`/opt/sucafina`** (unpacked from `sucafina-deploy.tar.gz`).
- **Stack:** `docker-compose.prod.yml` → two containers:
  - `sucafina-postgres-prod` (postgres:16-alpine) — private `sucafina-internal` network, volume `sucafina_pgdata`, **no published port**.
  - `sucafina-api` (built from `api/Dockerfile`, runs `tsx src/server.ts`) — on `sucafina-internal` **and** the external **`lua-edge`** network, **no published port**.
- **Env:** `/opt/sucafina/.env.prod` (`DB_PASSWORD`, `API_KEY`). ⚠️ The compose file marks these **required**, so **every** `docker compose` command must pass `--env-file .env.prod` (or run `set -a && . ./.env.prod && set +a` once in the shell first). Forgetting it is why the first deploy attempt failed silently.
- **Data:** seeded from `sucafina-seed.sql` (a `pg_dump` of the local dev DB) → specialty **1063** / bulk **1237** / forwarding **15** / clients **270** + events.
- **TLS / public URL:** served by the **pre-existing edge Caddy** (container `caddy`, config `/srv/lua/edge/Caddyfile`, network `lua-edge`). We appended one block:
  ```
  sucafina-api.luameet.in {
      reverse_proxy sucafina-api:4000
  }
  ```
  DNS: `sucafina-api.luameet.in  A  156.67.105.74` (DNS-only). Cert auto-issued by Caddy (Let's Encrypt, TLS-ALPN). A backup of the Caddyfile was saved as `/srv/lua/edge/Caddyfile.bak.<timestamp>`.

### Backend operations
```
cd /opt/sucafina
set -a && . ./.env.prod && set +a            # load env once per shell session

docker compose -f docker-compose.prod.yml ps                 # status
docker compose -f docker-compose.prod.yml logs -f api        # tail API logs
docker compose -f docker-compose.prod.yml restart api        # restart API
docker compose -f docker-compose.prod.yml exec postgres psql -U sucafina sucafina   # DB shell
```
- **Update the API code:** rebuild the archive locally (`git archive --format=tar.gz -o sucafina-deploy.tar.gz HEAD`), `scp` it up, `tar xzf` over `/opt/sucafina`, then `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`.
- **Backup the DB:** `docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U sucafina --no-owner --no-privileges sucafina > backup-$(date +%F).sql` (recommend a cron for this — see §6).
- **Change/rollback the Caddy route:** edit `/srv/lua/edge/Caddyfile` (or restore a `.bak.*`), then `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`. If a *newly added* site doesn't get a cert after `reload`, `docker restart caddy` forces issuance (brief ~5s blip to all edge sites; backends stay up).

## 3. Agent (Lua platform)
- **Agent:** `baseAgent_agent_1783420556773_cc6qh9f2y` (org `d9764ee0-5a19-4c0d-9407-a2e2e489a827`). Model `anthropic/claude-sonnet-5`. Active version **v2**.
- **Source:** top-level `src/` (`lua-cli` project). Skills @ v1.0.3: `sample-intake`, `client-book`, `dispatch-logging`, `status-and-tracking`, `results-capture`; job `daily-chaser` v1.0.3; **persona v3**.
- **What it does (Phase 5):**
  - **Data-in:** routes each intake to the right table and writes via three tools with **hard-required Zod schemas** — `create_specialty_sample` (needs description + sample_type + receiver_company), `create_bulk_sample` (quality + sample_type + client), `create_forwarding_sample` (sender + origin + sample_ref + coffee_quality + receiver_company + id_number). Normalization (courier/country/sample_type/AWB) in `src/lib/normalize.ts`.
  - **Data-out:** `search_samples` / `get_sample_status` / `list_awaiting_results` / `track_awb` work across all three tables via `/search` + `/tracking`. `record_dispatch` / `record_result` take `{tab,id}` and PATCH the right table.
  - Legacy `create_sample_request` (wrote the old `samples` table) is **retired** from the active skill set.
- **Platform env** (set for `sandbox` **and** `production`): `API_BASE_URL = https://sucafina-api.luameet.in`, `API_KEY = <§5>`. The cloud runtime uses these (not the local `.env`).

### Agent operations
```
lua chat -e production -m "log an offer sample of AA Swara to Beyers"   # test prod
lua chat -e sandbox   -m "..."                                          # test staged code
lua logs --limit 20                                                     # recent runs
lua env production --list                                               # inspect env
```
- **Update:** edit `src/` → `lua push all --force` → `lua deploy all --force` → `lua version create -m "..."` → `lua version promote <v>`.
- **Rollback:** `lua version list` then `lua version promote <previous>` (e.g. back to `v1`).
- ⚠️ **Source-backup caveat:** during the deploy push the *source backup* sync failed (`fetch failed`) — the running primitives are fine, but until you run **`lua push backup --force --fresh`**, `lua init` for this agent would restore an older snapshot. Non-urgent; do it when convenient.

## 4. Local `.env` (agent, dev only)
`./.env` (gitignored) points local `lua test`/`lua chat` at the live API:
```
API_BASE_URL=https://sucafina-api.luameet.in
API_KEY=<§5>
```
Change to `http://localhost:4000` if you want local `lua test` to hit a locally-running API instead.

## 5. Secrets — where they live (values NOT in this file)
Two secrets were generated at deploy time (`openssl rand -hex 24` each):
- **`API_KEY`** — the `x-api-key` the frontend + agent send. Lives in: VPS `/opt/sucafina/.env.prod`, Vercel env (`VITE_API_KEY`), Lua env (sandbox + production `API_KEY`). To rotate, change it in **all three** + `docker compose ... up -d` on the VPS.
- **`DB_PASSWORD`** — Postgres password. Lives only in VPS `/opt/sucafina/.env.prod` (Postgres isn't publicly reachable).

`.env.prod`, `sucafina-seed.sql`, and `sucafina-deploy.tar.gz` are gitignored — never committed.

## 6. Known follow-ups / caveats
- **Security:** `VITE_API_KEY` is world-readable in the bundle and CORS is `*`, so the API is effectively public behind a light gate. Add real auth + restrict CORS to the Vercel origin before putting sensitive data in.
- **DB backups:** none automated yet. Add a cron on the VPS running the `pg_dump` in §2.
- **Source backup:** run `lua push backup --force --fresh` (see §3).
- **Frontend polish + whole-branch review:** the Twenty-grade visual polish pass and the final code review were deferred (per the project plan) and are still open.
- **Custom domain (optional):** point e.g. `sucafina.luameet.in` at Vercel (CNAME) for the frontend instead of the `*.vercel.app` URL.
