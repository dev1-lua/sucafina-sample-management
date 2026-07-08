# Deploy runbook — Sucafina sample-chaser

Targets:
- **Frontend** (`dashboard-v2`) → **Vercel**
- **Backend** (`api` + Postgres) → **Contabo VPS `156.67.105.74`**, Docker, **integrated with the existing edge Caddy** (80/443 already owned by it — we do NOT run our own).
- **Agent** → **Lua platform** (`lua push` + `lua deploy`).

Public API URL: **`https://sucafina-api.luameet.in`** (a new subdomain of your existing `luameet.in`).

---

## 1. Secrets (laptop)
Use the SAME `API_KEY` value in all three places (VPS `.env.prod`, Vercel `VITE_API_KEY`, Lua env).
```
openssl rand -hex 24   # -> API_KEY
openssl rand -hex 24   # -> DB_PASSWORD
```

## 2. DNS
Add an A record at your `luameet.in` provider (same target as vexa/bridge/dashboard):
```
sucafina-api.luameet.in.   A   156.67.105.74
```
Caddy auto-issues the Let's Encrypt cert on first request.

## 3. Ship code + data (laptop → VPS)
```
rsync -avz --progress sucafina-deploy.tar.gz sucafina-seed.sql root@156.67.105.74:~/
```

## 4. Backend (on the VPS)
```
mkdir -p /opt/sucafina && mv ~/sucafina-deploy.tar.gz ~/sucafina-seed.sql /opt/sucafina/
cd /opt/sucafina && tar xzf sucafina-deploy.tar.gz
cp .env.prod.example .env.prod && nano .env.prod          # set DB_PASSWORD + API_KEY
# start DB, load the seed, then build+start the API:
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres
docker compose -f docker-compose.prod.yml exec -T postgres psql -U sucafina sucafina < sucafina-seed.sql
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml ps               # api + postgres healthy
```

## 5. Add the route to your EXISTING Caddy (surgical + reversible)
```
cp /srv/lua/edge/Caddyfile /srv/lua/edge/Caddyfile.bak.$(date +%s)      # backup first
cat >> /srv/lua/edge/Caddyfile <<'EOF'

sucafina-api.luameet.in {
    reverse_proxy sucafina-api:4000
}
EOF
docker exec caddy caddy reload --config /etc/caddy/Caddyfile             # graceful; other sites keep serving
```
Rollback if anything looks off:
```
cp /srv/lua/edge/Caddyfile.bak.<ts> /srv/lua/edge/Caddyfile && docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## 6. Verify
```
curl https://sucafina-api.luameet.in/health                                  # {"ok":true}
curl -H "x-api-key: <API_KEY>" -H "x-actor: dashboard" https://sucafina-api.luameet.in/stats
# sanity: your other sites still up
curl -sI https://vexa.luameet.in | head -1
```

## 7. Frontend on Vercel (laptop, CLI — no git remote needed)
```
cd dashboard-v2 && npx vercel        # login + link; set env when prompted:
#   VITE_API_BASE = https://sucafina-api.luameet.in
#   VITE_API_KEY  = <API_KEY from step 1>
npx vercel --prod
```

## 8. Agent on the Lua platform (run by Claude here once step 6 is green)
```
lua env      # set for sandbox + production:
#   API_BASE_URL = https://sucafina-api.luameet.in
#   API_KEY      = <API_KEY>
lua chat -e sandbox -m "log an offer sample of AA Swara to Beyers"   # smoke test
lua push && lua deploy
```

---

## Security notes
- **`VITE_API_KEY` ships in the frontend JS bundle** → world-readable, not a real secret. With `Access-Control-Allow-Origin: *`, the API is effectively public behind a light gate. Fine for a demo; add real auth + lock CORS to the Vercel origin before any sensitive data.
- This stack is fully namespaced (`sucafina-*` containers, private `sucafina-internal` net, own volume, no published ports) so it can't touch the vexa/edge services. Only the one Caddy route is shared surface.
- `.env.prod` and `sucafina-seed.sql` are gitignored — never commit secrets or dumps.
