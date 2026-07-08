# Deploy runbook — Sucafina sample-chaser

Three targets:
- **Frontend** (`dashboard-v2`) → **Vercel**
- **Backend** (`api` + Postgres) → **Contabo VPS** `156.67.105.74` via Docker Compose + Caddy (auto-HTTPS at `156-67-105-74.nip.io`)
- **Agent** → **Lua platform** (`lua push` + `lua deploy`), pointed at the public API URL

Public API URL after this: `https://156-67-105-74.nip.io`

---

## 0. One-time: pick your secrets
Generate two strong values (keep them; you'll paste them in 3 places):
```
openssl rand -hex 24   # -> API_KEY
openssl rand -hex 24   # -> DB_PASSWORD
```

## 1. Backend on the VPS

### 1a. Open the firewall (on the VPS)
Ensure inbound **22, 80, 443** are allowed. Postgres (5432) stays closed — it's never published.
```
sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable   # if using ufw
```

### 1b. Get the code onto the VPS
```
ssh root@156.67.105.74
git clone <your-repo-url> sucafina && cd sucafina
git checkout feature/sample-management-agent
```
(No git remote? `scp -r` the project up instead, excluding node_modules.)

### 1c. Create `.env.prod` on the VPS
```
cp .env.prod.example .env.prod
# edit .env.prod: set DB_PASSWORD + API_KEY to the openssl values from step 0.
# API_DOMAIN is already 156-67-105-74.nip.io
```

### 1d. Bring up Postgres first, load the seed data, then the rest
```
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d postgres
# copy the dump up from your laptop (see step 1e), then:
docker compose -f docker-compose.prod.yml exec -T postgres psql -U sucafina sucafina < sucafina-seed.sql
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

### 1e. The seed dump (run on your LAPTOP, then scp up)
I generated `sucafina-seed.sql` in the repo root from your local DB (specialty 1063 / bulk 1237 / forwarding 15 / clients 270 + events). Copy it to the VPS repo dir:
```
scp sucafina-seed.sql root@156.67.105.74:~/sucafina/sucafina-seed.sql
```

### 1f. Verify (from anywhere)
```
curl https://156-67-105-74.nip.io/health              # -> {"ok":true}
curl -H "x-api-key: <API_KEY>" -H "x-actor: dashboard" https://156-67-105-74.nip.io/stats
```
First HTTPS hit may take ~30s while Caddy provisions the Let's Encrypt cert. If cert issuance fails (nip.io LE hiccup), switch `API_DOMAIN` to a DuckDNS subdomain and `docker compose ... up -d caddy` again.

## 2. Frontend on Vercel
In the Vercel dashboard → **New Project** → import this repo:
- **Root Directory:** `dashboard-v2`
- Framework preset: **Vite** (build `npm run build`, output `dist` — already in `vercel.json`)
- **Environment Variables:**
  - `VITE_API_BASE` = `https://156-67-105-74.nip.io`
  - `VITE_API_KEY`  = the `API_KEY` from step 0
- Deploy. (CLI alternative: `cd dashboard-v2 && npx vercel --prod`, set the two env vars when prompted.)

## 3. Agent on the Lua platform
The cloud-run agent reads env from the Lua platform (not the local `.env`). Point it at the public API:
```
lua env            # inspect / set API_BASE_URL and API_KEY for the sandbox (and production) env
#   API_BASE_URL = https://156-67-105-74.nip.io
#   API_KEY      = <API_KEY from step 0>
lua chat -e sandbox -m "log an offer sample of AA Swara to Beyers"   # smoke test in sandbox
lua push           # push code + config
lua deploy         # promote to production
```

---

## Security notes (read before sharing the URL)
- **`VITE_API_KEY` is embedded in the frontend JS bundle** → it is world-readable, not a real secret. Combined with `Access-Control-Allow-Origin: *`, the API is effectively public behind a light gate. Fine for a demo; **before real/sensitive data**, add proper auth (e.g., per-user tokens) and restrict CORS to the Vercel origin.
- Postgres is not published to the host (only reachable inside the compose network) — keep it that way.
- Rotate `API_KEY`/`DB_PASSWORD` if this repo or the values are ever shared.
- `.env.prod` and `sucafina-seed.sql` are gitignored — never commit real secrets or data dumps.
