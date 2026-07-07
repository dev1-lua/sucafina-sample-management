# Sample Management Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working prototype where Sucafina's quality team manages the coffee-sample lifecycle (request → dispatch → deliver → results) through a Lua AI agent + Postgres-backed REST API + mini-CRM dashboard, seeded with their real Sample Chaser data.

**Architecture:** Local Docker Postgres is the system of record; an Express API is the *only* gateway to it (called by both the dashboard and the Lua agent's tools; agent reaches it via a tunnel since it runs in Lua's cloud). The Lua agent supplies 5 skills, a daily chaser job, and a chat-native persona. Spec: `docs/superpowers/specs/2026-07-07-sample-management-agent-design.md`.

**Tech Stack:** TypeScript everywhere (ESM, strict). API: Express 4 + `pg` + `zod`, tested with vitest + supertest. Seed: `xlsx` (SheetJS) + `pg`. Agent: `lua-cli` (LuaTool/LuaSkill/LuaJob, zod schemas). Dashboard: Vite + React 18 + react-router-dom, LuaPop widget.

## Global Constraints

- Node >= 20; all packages `"type": "module"`; TypeScript `strict: true`
- Postgres 16 in Docker, host port **5433**; dev DB `sucafina`, test DB `sucafina_test`; user/password `sucafina`/`sucafina`
- API listens on port **4000**; every endpoint except `GET /health` requires header `x-api-key` (dev value: `dev-key-sucafina`)
- `api/`, `dashboard/`, `scripts/` are independent npm packages (no workspaces — the repo root `package.json` belongs to the lua-cli agent and must not be turned into a workspace root)
- Repo root `package.json` / `tsconfig.json` (lua-cli project) must keep compiling: verify with `npx lua compile` after agent changes. NEVER run bare `lua deploy` (blocked by hooks; deploys happen via /lua-deploy only)
- Agent model stays `anthropic/claude-sonnet-5`; agent id `baseAgent_agent_1783420556773_cc6qh9f2y` (from `lua.skill.yaml`)
- Timezone for the chaser job: `Africa/Nairobi`
- Never invent data in agent replies; every mutation writes a `sample_events` row with an `actor`
- Seed must never drop a row for being unparseable — normalized column stays NULL, raw column keeps the original value
- Commit after every task (git repo already initialized)

**Source data quality facts** (verified 2026-07-07, drive parser test cases): Specialty sheet 1,063 rows / Bulk 1,237 / Client Details 298 (~270 distinct companies). Result filled 0.0% / 4.9%. Courier has 19 spellings incl. `KIPTOO`, `H/D`, `By Hand`, `Picked by Client`, `wellsfargo`. Qty mixes `200`, `1KG`, `500g`, `60+ROAST`. Sample Type has 80 variants like `PSS JUNE SHIPMENT`. Dates are ~60% datetime cells, ~40% strings like `14/1/2025`. Refs are non-unique (`SSKE-103499 A…G`, re-sends).

---

### Task 1: Infrastructure — Docker Postgres + API package with `/health`

**Files:**
- Create: `docker-compose.yml`
- Create: `api/migrations/000_create_test_db.sql`
- Create: `api/package.json`, `api/tsconfig.json`, `api/vitest.config.ts`
- Create: `api/src/app.ts`, `api/src/server.ts`
- Test: `api/test/health.test.ts`
- Modify: `.gitignore` (append api/dashboard/scripts artifacts)

**Interfaces:**
- Produces: running Postgres at `postgres://sucafina:sucafina@localhost:5433/sucafina` (+ `sucafina_test`); exported `app` (Express instance without `.listen`) from `api/src/app.ts`; `npm test` / `npm run dev` scripts in `api/`.

- [ ] **Step 1: Write `docker-compose.yml`** at repo root:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: sucafina-postgres
    ports:
      - "5433:5432"
    environment:
      POSTGRES_USER: sucafina
      POSTGRES_PASSWORD: sucafina
      POSTGRES_DB: sucafina
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./api/migrations/000_create_test_db.sql:/docker-entrypoint-initdb.d/000_create_test_db.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sucafina"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
```

- [ ] **Step 2: Write `api/migrations/000_create_test_db.sql`**:

```sql
CREATE DATABASE sucafina_test OWNER sucafina;
```

- [ ] **Step 3: Start Postgres and verify**

Run: `docker compose up -d postgres && sleep 6 && docker exec sucafina-postgres psql -U sucafina -c '\l' | grep sucafina`
Expected: lists both `sucafina` and `sucafina_test`.

- [ ] **Step 4: Scaffold the api package.** `api/package.json`:

```json
{
  "name": "sucafina-sample-api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "migrate": "tsx scripts/migrate.ts",
    "db:reset": "tsx scripts/migrate.ts --reset",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^4.19.0",
    "pg": "^8.12.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/pg": "^8.11.0",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`api/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src", "test", "scripts"]
}
```

`api/vitest.config.ts` (single-threaded — tests share one DB):

```ts
import { defineConfig } from 'vitest/config';

process.env.DATABASE_URL ??= 'postgres://sucafina:sucafina@localhost:5433/sucafina_test';
process.env.API_KEY ??= 'dev-key-sucafina';

export default defineConfig({
  test: {
    poolOptions: { threads: { singleThread: true } },
  },
});
```

Run: `cd api && npm install`

- [ ] **Step 5: Write the failing test** `api/test/health.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

describe('GET /health', () => {
  it('returns ok without an api key', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd api && npm test`
Expected: FAIL — cannot find module `../src/app.js`.

- [ ] **Step 7: Write `api/src/app.ts`**:

```ts
import express from 'express';

export const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));
```

And `api/src/server.ts`:

```ts
import { app } from './app.js';

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`sample-api listening on :${port}`));
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd api && npm test`
Expected: PASS (1 test).

- [ ] **Step 9: Append to root `.gitignore`**:

```
# services
api/node_modules/
api/dist/
dashboard/node_modules/
dashboard/dist/
scripts/node_modules/
scripts/seed-report.json
*.env
```

- [ ] **Step 10: Commit**

```bash
git add docker-compose.yml api .gitignore
git commit -m "feat(api): docker postgres + express scaffold with /health"
```

---

### Task 2: Database schema + migrate script

**Files:**
- Create: `api/migrations/001_init.sql`
- Create: `api/scripts/migrate.ts`
- Create: `api/src/db.ts`
- Test: `api/test/schema.test.ts`

**Interfaces:**
- Produces: all enums/tables from the spec; `pool` (pg.Pool) exported from `api/src/db.ts`; `npm run migrate` / `npm run db:reset` (reset drops `public` schema first). Later tasks rely on table/column names EXACTLY as written here.

- [ ] **Step 1: Write `api/migrations/001_init.sql`** (spec §4, plus `moisture`/`water_activity` which the Bulk sheet carries):

```sql
CREATE TYPE sample_type_t AS ENUM
  ('offer','type','pss','woc','retention','flavor_mapping','marketing','calibration','other');
CREATE TYPE sample_status_t AS ENUM
  ('requested','preparing','dispatched','delivered','results_in','cancelled');
CREATE TYPE courier_t AS ENUM
  ('dhl','fedex','ups','rider','hand_delivery','client_pickup','other');
CREATE TYPE result_t AS ENUM ('approved','rejected','pending_feedback');
CREATE TYPE event_type_t AS ENUM
  ('requested','status_change','dispatched','delivery_update','result_logged','chased','note','edited');

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  country text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clients_name_lower_idx ON clients ((lower(name)));

CREATE TABLE client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  attention_to text,
  full_address text,
  phone text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref text,
  ref_raw text,
  source_sheet text NOT NULL DEFAULT 'agent',
  sample_type sample_type_t NOT NULL DEFAULT 'other',
  shipment_month text,
  quality text,
  grade text,
  outturn text,
  mark_name text,
  ico_mark text,
  client_ref text,
  bags integer,
  qty_grams integer,
  qty_raw text,
  moisture text,
  water_activity text,
  client_id uuid REFERENCES clients(id),
  receiver text,
  requester text,
  deadline date,
  roast_instructions text,
  status sample_status_t NOT NULL DEFAULT 'requested',
  courier courier_t,
  courier_raw text,
  awb text,
  requested_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  result result_t,
  cupping_notes text,
  comments text,
  crop_year text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX samples_ref_idx ON samples (ref);
CREATE INDEX samples_status_idx ON samples (status);
CREATE INDEX samples_client_idx ON samples (client_id);
CREATE INDEX samples_awb_idx ON samples (awb);

CREATE TABLE sample_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id uuid NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
  type event_type_t NOT NULL,
  note text,
  actor text NOT NULL DEFAULT 'api',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sample_events_sample_idx ON sample_events (sample_id, created_at);

CREATE TABLE ref_counters (
  prefix text PRIMARY KEY,
  next_val integer NOT NULL
);
INSERT INTO ref_counters (prefix, next_val) VALUES ('SL', 8000), ('TYPE', 1000), ('SSKE', 108000);

CREATE TABLE chaser_digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Write `api/scripts/migrate.ts`**:

```ts
import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://sucafina:sucafina@localhost:5433/sucafina';
const client = new pg.Client({ connectionString: url });
await client.connect();

if (process.argv.includes('--reset')) {
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('schema dropped');
}
const sql = readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8');
await client.query(sql);
console.log(`migrated ${url}`);
await client.end();
```

- [ ] **Step 3: Write `api/src/db.ts`**:

```ts
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://sucafina:sucafina@localhost:5433/sucafina',
});
```

- [ ] **Step 4: Write the failing test** `api/test/schema.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb } from './helpers.js';
import { pool } from '../src/db.js';

beforeAll(resetDb);

describe('schema', () => {
  it('creates all tables', async () => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
    );
    const names = rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining(['clients', 'client_contacts', 'samples', 'sample_events', 'ref_counters', 'chaser_digests'])
    );
  });

  it('seeds ref counters', async () => {
    const { rows } = await pool.query(`SELECT prefix, next_val FROM ref_counters ORDER BY prefix`);
    expect(rows).toEqual([
      { prefix: 'SL', next_val: 8000 },
      { prefix: 'SSKE', next_val: 108000 },
      { prefix: 'TYPE', next_val: 1000 },
    ]);
  });
});
```

And the shared helper `api/test/helpers.ts`:

```ts
import { readFileSync } from 'node:fs';
import { pool } from '../src/db.js';

export const API_KEY = 'dev-key-sucafina';

export async function resetDb() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const sql = readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd api && npm test`
Expected: schema.test FAILs (helpers/db modules exist now, but run once to confirm wiring; if it passes immediately because Steps 1–3 are already written, that's fine — the failing-first check here is the initial module-not-found run).

- [ ] **Step 6: Run migration against the dev DB too**

Run: `cd api && npm run migrate`
Expected: `migrated postgres://sucafina:sucafina@localhost:5433/sucafina`

- [ ] **Step 7: Run tests to verify pass**

Run: `cd api && npm test`
Expected: PASS (health + 2 schema tests).

- [ ] **Step 8: Commit**

```bash
git add api
git commit -m "feat(api): postgres schema, migrate script, db pool"
```

---

### Task 3: API auth middleware, error handling, clients routes

**Files:**
- Create: `api/src/auth.ts`, `api/src/errors.ts`, `api/src/routes/clients.ts`
- Modify: `api/src/app.ts`
- Test: `api/test/clients.test.ts`

**Interfaces:**
- Consumes: `pool` from Task 2.
- Produces: `requireApiKey` middleware; `HttpError` + `parseBody(schema, body)`; endpoints `GET /clients?q=`, `POST /clients` (upsert by lower(name), optional inline contact), `GET /clients/:id` (with `contacts`), `PATCH /clients/:id`, `POST /clients/:id/contacts`. List response shape used everywhere: `{ data: T[], total: number }`.

- [ ] **Step 1: Write the failing tests** `api/test/clients.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);

const auth = (r: request.Test) => r.set('x-api-key', API_KEY);

describe('clients', () => {
  it('rejects missing api key', async () => {
    const res = await request(app).get('/clients');
    expect(res.status).toBe(401);
  });

  let beyersId: string;

  it('creates a client with an inline contact', async () => {
    const res = await auth(request(app).post('/clients')).send({
      name: 'Beyers Koffie',
      country: 'Belgium',
      contact: { attention_to: 'Thomas Pitault', full_address: 'Koning Leopoldlaan 3, 2870 Puurs' },
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Beyers Koffie');
    beyersId = res.body.id;
  });

  it('upserts on duplicate name (case-insensitive)', async () => {
    const res = await auth(request(app).post('/clients')).send({ name: 'BEYERS KOFFIE' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(beyersId);
  });

  it('searches by partial name', async () => {
    const res = await auth(request(app).get('/clients?q=beyer'));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].name).toBe('Beyers Koffie');
  });

  it('gets client with contacts', async () => {
    const res = await auth(request(app).get(`/clients/${beyersId}`));
    expect(res.status).toBe(200);
    expect(res.body.contacts).toHaveLength(1);
    expect(res.body.contacts[0].attention_to).toBe('Thomas Pitault');
  });

  it('patches a client', async () => {
    const res = await auth(request(app).patch(`/clients/${beyersId}`)).send({ country: 'BE' });
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('BE');
  });

  it('validates bodies with zod', async () => {
    const res = await auth(request(app).post('/clients')).send({});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd api && npm test -- clients`
Expected: FAIL — 404s (routes not mounted) / 401 test failing.

- [ ] **Step 3: Implement.** `api/src/errors.ts`:

```ts
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, 'validation failed', r.error.flatten());
  return r.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details ?? null });
  }
  console.error(err);
  return res.status(500).json({ error: 'internal error' });
}
```

`api/src/auth.ts`:

```ts
import type { NextFunction, Request, Response } from 'express';

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.API_KEY ?? 'dev-key-sucafina';
  if (req.header('x-api-key') !== expected) {
    return res.status(401).json({ error: 'invalid api key' });
  }
  next();
}

export function actorFrom(req: Request): string {
  return req.header('x-actor') ?? 'api';
}
```

`api/src/routes/clients.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody } from '../errors.js';

export const clients = Router();

const contactSchema = z.object({
  attention_to: z.string().nullish(),
  full_address: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
});

const clientSchema = z.object({
  name: z.string().min(1),
  country: z.string().nullish(),
  contact: contactSchema.nullish(),
});

clients.get('/', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const { rows } = await pool.query(
    `SELECT c.*, (SELECT count(*)::int FROM client_contacts cc WHERE cc.client_id = c.id) AS contact_count
     FROM clients c
     WHERE ($1 = '' OR c.name ILIKE '%' || $1 || '%')
     ORDER BY c.name LIMIT 50`,
    [q]
  );
  res.json({ data: rows, total: rows.length });
});

clients.post('/', async (req, res) => {
  const body = parseBody(clientSchema, req.body);
  const existing = await pool.query(`SELECT * FROM clients WHERE lower(name) = lower($1)`, [body.name]);
  let client;
  let created = false;
  if (existing.rows[0]) {
    client = existing.rows[0];
  } else {
    const ins = await pool.query(
      `INSERT INTO clients (name, country) VALUES ($1, $2) RETURNING *`,
      [body.name.trim(), body.country ?? null]
    );
    client = ins.rows[0];
    created = true;
  }
  if (body.contact) {
    await pool.query(
      `INSERT INTO client_contacts (client_id, attention_to, full_address, phone, email)
       VALUES ($1, $2, $3, $4, $5)`,
      [client.id, body.contact.attention_to ?? null, body.contact.full_address ?? null,
       body.contact.phone ?? null, body.contact.email ?? null]
    );
  }
  res.status(created ? 201 : 200).json(client);
});

clients.get('/:id', async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM clients WHERE id = $1`, [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'client not found');
  const contacts = await pool.query(
    `SELECT * FROM client_contacts WHERE client_id = $1 ORDER BY created_at`,
    [req.params.id]
  );
  res.json({ ...rows[0], contacts: contacts.rows });
});

clients.patch('/:id', async (req, res) => {
  const body = parseBody(clientSchema.partial(), req.body);
  const { rows } = await pool.query(
    `UPDATE clients SET
       name = COALESCE($2, name),
       country = COALESCE($3, country),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id, body.name ?? null, body.country ?? null]
  );
  if (!rows[0]) throw new HttpError(404, 'client not found');
  res.json(rows[0]);
});

clients.post('/:id/contacts', async (req, res) => {
  const body = parseBody(contactSchema, req.body);
  const { rows } = await pool.query(
    `INSERT INTO client_contacts (client_id, attention_to, full_address, phone, email)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.params.id, body.attention_to ?? null, body.full_address ?? null, body.phone ?? null, body.email ?? null]
  );
  res.status(201).json(rows[0]);
});
```

Update `api/src/app.ts` (full file — Express 4 needs async errors forwarded, so wrap routers with a tiny helper):

```ts
import express from 'express';
import { requireApiKey } from './auth.js';
import { errorHandler } from './errors.js';
import { clients } from './routes/clients.js';

export const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS for the local dashboard
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-api-key,x-actor');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  next();
});
app.options(/.*/, (_req, res) => res.sendStatus(204));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use(requireApiKey);
app.use('/clients', clients);

app.use(errorHandler);
```

**Express 4 async-error gotcha:** thrown errors in `async` handlers are NOT caught automatically. Add this monkey-patch at the top of `api/src/routes/clients.ts` and every future route file — wrap each handler: replace direct `async (req,res)` registration with the `h()` wrapper below, defined once in `api/src/errors.ts`:

```ts
// add to api/src/errors.ts
import type { RequestHandler } from 'express';
export const h = (fn: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };
```

Then every route registration becomes e.g. `clients.get('/', h(async (req, res) => { ... }))`. Apply `h(...)` to ALL async handlers in this and later tasks.

- [ ] **Step 4: Run tests to verify pass**

Run: `cd api && npm test`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add api
git commit -m "feat(api): auth, error handling, clients CRUD"
```

---

### Task 4: Samples routes — list/filters, create with ref issuance, patch with events

**Files:**
- Create: `api/src/routes/samples.ts`, `api/src/lib/refs.ts`, `api/src/lib/events.ts`
- Modify: `api/src/app.ts` (mount `/samples`)
- Test: `api/test/samples.test.ts`

**Interfaces:**
- Consumes: `pool`, `h`, `parseBody`, `HttpError`, `actorFrom`.
- Produces:
  - `issueRef(sampleType: string): Promise<string>` — `pss→SSKE-<n>`, `type→TYPE-<n>`, else `SL-<n>` (atomic counter increment)
  - `addEvent(sampleId: string, type: string, note: string, actor: string): Promise<void>`
  - `GET /samples` filters: `status` (comma list), `sample_type`, `client_id`, `q` (ILIKE over ref/ref_raw/quality/receiver), `overdue=true`, `awaiting_results=true`, `page`, `pageSize` (default 1/25) → `{ data, total, page, pageSize }`
  - `POST /samples` → 201 sample row (ref auto-issued when absent; `requested` event written)
  - `GET /samples/:id` → `{ ...sample, events: [...] }`
  - `PATCH /samples/:id` → updated row; writes `dispatched` / `result_logged` / `status_change` / `edited` event
  - `GET /samples/:id/events` → `{ data: events }`

- [ ] **Step 1: Write the failing tests** `api/test/samples.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('samples', () => {
  let id: string;

  it('creates a sample and issues an SL ref', async () => {
    const res = await auth(request(app).post('/samples')).send({
      sample_type: 'offer',
      quality: 'AB FAQ',
      receiver: 'Beyers',
      requester: 'Omar',
      qty_grams: 500,
      deadline: '2026-07-10',
    });
    expect(res.status).toBe(201);
    expect(res.body.ref).toBe('SL-8000');
    expect(res.body.status).toBe('requested');
    id = res.body.id;
  });

  it('issues TYPE refs for type samples and SSKE for pss', async () => {
    const t = await auth(request(app).post('/samples')).send({ sample_type: 'type', quality: 'ABC FAQ', receiver: 'Beyers' });
    expect(t.body.ref).toBe('TYPE-1000');
    const p = await auth(request(app).post('/samples')).send({ sample_type: 'pss', quality: 'AA SANGALAI', receiver: 'Sucafina Yunnan' });
    expect(p.body.ref).toBe('SSKE-108000');
  });

  it('records a requested event with actor', async () => {
    const res = await auth(request(app).get(`/samples/${id}/events`));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ type: 'requested', actor: 'test' });
  });

  it('filters by status and q', async () => {
    const res = await auth(request(app).get('/samples?status=requested&q=beyers'));
    expect(res.body.total).toBe(2);
  });

  it('dispatch via PATCH writes dispatched event and timestamps', async () => {
    const res = await auth(request(app).patch(`/samples/${id}`)).send({
      status: 'dispatched', courier: 'dhl', awb: '9620551651',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('dispatched');
    expect(res.body.dispatched_at).toBeTruthy();
    const ev = await auth(request(app).get(`/samples/${id}/events`));
    expect(ev.body.data.map((e: { type: string }) => e.type)).toContain('dispatched');
  });

  it('result via PATCH writes result_logged and results_in status', async () => {
    await auth(request(app).patch(`/samples/${id}`)).send({ status: 'delivered' });
    const res = await auth(request(app).patch(`/samples/${id}`)).send({
      result: 'approved', cupping_notes: '83p, citrus driven, clean',
    });
    expect(res.body.status).toBe('results_in');
    expect(res.body.result).toBe('approved');
  });

  it('overdue filter finds past-deadline undispatched samples', async () => {
    await auth(request(app).post('/samples')).send({
      sample_type: 'offer', quality: 'PB', receiver: 'Key Coffee', deadline: '2026-01-01',
    });
    const res = await auth(request(app).get('/samples?overdue=true'));
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].receiver).toBe('Key Coffee');
  });

  it('awaiting_results filter finds delivered samples without result', async () => {
    const s = await auth(request(app).post('/samples')).send({ sample_type: 'pss', quality: 'AAA', receiver: 'Nestrade' });
    await auth(request(app).patch(`/samples/${s.body.id}`)).send({ status: 'delivered' });
    const res = await auth(request(app).get('/samples?awaiting_results=true'));
    expect(res.body.total).toBe(1);
  });

  it('404s on unknown sample', async () => {
    const res = await auth(request(app).get('/samples/00000000-0000-0000-0000-000000000000'));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd api && npm test -- samples`
Expected: FAIL — 404 (route not mounted).

- [ ] **Step 3: Implement.** `api/src/lib/refs.ts`:

```ts
import { pool } from '../db.js';

const PREFIX: Record<string, string> = { pss: 'SSKE', type: 'TYPE' };

export async function issueRef(sampleType: string): Promise<string> {
  const prefix = PREFIX[sampleType] ?? 'SL';
  const { rows } = await pool.query(
    `UPDATE ref_counters SET next_val = next_val + 1 WHERE prefix = $1 RETURNING next_val - 1 AS val`,
    [prefix]
  );
  return `${prefix}-${rows[0].val}`;
}
```

`api/src/lib/events.ts`:

```ts
import { pool } from '../db.js';

export async function addEvent(sampleId: string, type: string, note: string, actor: string) {
  await pool.query(
    `INSERT INTO sample_events (sample_id, type, note, actor) VALUES ($1, $2, $3, $4)`,
    [sampleId, type, note, actor]
  );
}
```

`api/src/routes/samples.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { actorFrom } from '../auth.js';
import { issueRef } from '../lib/refs.js';
import { addEvent } from '../lib/events.js';

export const samples = Router();

const SAMPLE_TYPES = ['offer','type','pss','woc','retention','flavor_mapping','marketing','calibration','other'] as const;
const STATUSES = ['requested','preparing','dispatched','delivered','results_in','cancelled'] as const;
const COURIERS = ['dhl','fedex','ups','rider','hand_delivery','client_pickup','other'] as const;
const RESULTS = ['approved','rejected','pending_feedback'] as const;

const createSchema = z.object({
  ref: z.string().nullish(),
  sample_type: z.enum(SAMPLE_TYPES).default('other'),
  quality: z.string().min(1),
  grade: z.string().nullish(),
  outturn: z.string().nullish(),
  bags: z.number().int().nullish(),
  qty_grams: z.number().int().nullish(),
  client_id: z.string().uuid().nullish(),
  receiver: z.string().min(1),
  requester: z.string().nullish(),
  deadline: z.string().nullish(),
  roast_instructions: z.string().nullish(),
  shipment_month: z.string().nullish(),
  comments: z.string().nullish(),
});

const patchSchema = z.object({
  status: z.enum(STATUSES).nullish(),
  courier: z.enum(COURIERS).nullish(),
  awb: z.string().nullish(),
  result: z.enum(RESULTS).nullish(),
  cupping_notes: z.string().nullish(),
  quality: z.string().nullish(),
  grade: z.string().nullish(),
  qty_grams: z.number().int().nullish(),
  client_id: z.string().uuid().nullish(),
  receiver: z.string().nullish(),
  requester: z.string().nullish(),
  deadline: z.string().nullish(),
  roast_instructions: z.string().nullish(),
  comments: z.string().nullish(),
});

samples.get('/', h(async (req, res) => {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => { params.push(value); where.push(clause.replace('?', `$${params.length}`)); };

  if (req.query.status) {
    add(`status = ANY (?::sample_status_t[])`, String(req.query.status).split(','));
  }
  if (req.query.sample_type) add(`sample_type = ?::sample_type_t`, String(req.query.sample_type));
  if (req.query.client_id) add(`client_id = ?::uuid`, String(req.query.client_id));
  if (req.query.q) {
    add(`(ref ILIKE '%'||?||'%' OR ref_raw ILIKE '%'||$${params.length + 1}||'%' OR quality ILIKE '%'||$${params.length + 1}||'%' OR receiver ILIKE '%'||$${params.length + 1}||'%')`, String(req.query.q));
  }
  if (req.query.overdue === 'true') {
    where.push(`status IN ('requested','preparing') AND (deadline < CURRENT_DATE OR (deadline IS NULL AND coalesce(requested_at, created_at) < now() - interval '3 days'))`);
  }
  if (req.query.awaiting_results === 'true') {
    where.push(`status = 'delivered' AND result IS NULL`);
  }

  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 25)));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const count = await pool.query(`SELECT count(*)::int AS n FROM samples ${whereSql}`, params);
  const { rows } = await pool.query(
    `SELECT * FROM samples ${whereSql}
     ORDER BY coalesce(requested_at, created_at) DESC
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params
  );
  res.json({ data: rows, total: count.rows[0].n, page, pageSize });
}));

samples.post('/', h(async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const actor = actorFrom(req);
  const ref = body.ref ?? (await issueRef(body.sample_type));
  const { rows } = await pool.query(
    `INSERT INTO samples
       (ref, sample_type, quality, grade, outturn, bags, qty_grams, client_id, receiver,
        requester, deadline, roast_instructions, shipment_month, comments, status, requested_at, source_sheet)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'requested', now(), 'agent')
     RETURNING *`,
    [ref, body.sample_type, body.quality, body.grade ?? null, body.outturn ?? null, body.bags ?? null,
     body.qty_grams ?? null, body.client_id ?? null, body.receiver, body.requester ?? null,
     body.deadline ?? null, body.roast_instructions ?? null, body.shipment_month ?? null, body.comments ?? null]
  );
  await addEvent(rows[0].id, 'requested', `${body.quality} for ${body.receiver}${body.requester ? ` (by ${body.requester})` : ''}`, actor);
  res.status(201).json(rows[0]);
}));

samples.get('/:id', h(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM samples WHERE id = $1`, [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'sample not found');
  const events = await pool.query(
    `SELECT * FROM sample_events WHERE sample_id = $1 ORDER BY created_at`, [req.params.id]);
  res.json({ ...rows[0], events: events.rows });
}));

samples.get('/:id/events', h(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM sample_events WHERE sample_id = $1 ORDER BY created_at`, [req.params.id]);
  res.json({ data: rows });
}));

samples.patch('/:id', h(async (req, res) => {
  const body = parseBody(patchSchema, req.body);
  const actor = actorFrom(req);
  const cur = await pool.query(`SELECT * FROM samples WHERE id = $1`, [req.params.id]);
  if (!cur.rows[0]) throw new HttpError(404, 'sample not found');
  const prev = cur.rows[0];

  // result implies results_in
  const nextStatus = body.result ? 'results_in' : body.status ?? null;

  const { rows } = await pool.query(
    `UPDATE samples SET
       status = COALESCE($2::sample_status_t, status),
       courier = COALESCE($3::courier_t, courier),
       awb = COALESCE($4, awb),
       result = COALESCE($5::result_t, result),
       cupping_notes = COALESCE($6, cupping_notes),
       quality = COALESCE($7, quality),
       grade = COALESCE($8, grade),
       qty_grams = COALESCE($9, qty_grams),
       client_id = COALESCE($10::uuid, client_id),
       receiver = COALESCE($11, receiver),
       requester = COALESCE($12, requester),
       deadline = COALESCE($13::date, deadline),
       roast_instructions = COALESCE($14, roast_instructions),
       comments = COALESCE($15, comments),
       dispatched_at = CASE WHEN $2 = 'dispatched' AND dispatched_at IS NULL THEN now() ELSE dispatched_at END,
       delivered_at  = CASE WHEN $2 = 'delivered'  AND delivered_at  IS NULL THEN now() ELSE delivered_at END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id, nextStatus, body.courier ?? null, body.awb ?? null, body.result ?? null,
     body.cupping_notes ?? null, body.quality ?? null, body.grade ?? null, body.qty_grams ?? null,
     body.client_id ?? null, body.receiver ?? null, body.requester ?? null, body.deadline ?? null,
     body.roast_instructions ?? null, body.comments ?? null]
  );

  const eventType =
    body.status === 'dispatched' ? 'dispatched'
    : body.result ? 'result_logged'
    : nextStatus && nextStatus !== prev.status ? 'status_change'
    : 'edited';
  const note =
    eventType === 'dispatched' ? `via ${body.courier ?? prev.courier ?? '?'} AWB ${body.awb ?? prev.awb ?? '—'}`
    : eventType === 'result_logged' ? `${body.result}${body.cupping_notes ? `: ${body.cupping_notes}` : ''}`
    : eventType === 'status_change' ? `${prev.status} → ${nextStatus}`
    : `fields updated: ${Object.keys(body).join(', ')}`;
  await addEvent(req.params.id, eventType, note, actor);
  res.json(rows[0]);
}));
```

Mount in `api/src/app.ts` after clients:

```ts
import { samples } from './routes/samples.js';
// ...
app.use('/samples', samples);
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd api && npm test`
Expected: PASS (all suites). Note: the `q` filter uses one param referenced multiple times — if the `$n` arithmetic fails, simplify by pushing the same value three more times; the test tells you.

- [ ] **Step 5: Commit**

```bash
git add api
git commit -m "feat(api): samples CRUD with ref issuance, filters, event trail"
```

---

### Task 5: Stats endpoint + deterministic tracking stub

**Files:**
- Create: `api/src/routes/stats.ts`, `api/src/lib/tracking.ts`, `api/src/routes/tracking.ts`
- Modify: `api/src/app.ts` (mount `/stats`, `/tracking`)
- Test: `api/test/stats-tracking.test.ts`

**Interfaces:**
- Produces:
  - `GET /stats` → `{ by_status: Record<string, number>, overdue: number, in_transit: number, awaiting_results: number, dispatched_this_week: number }`
  - `TrackingProvider` interface: `track(awb: string, dispatchedAt: Date | null, now?: Date): TrackingInfo` where `TrackingInfo = { awb: string, status: 'in_transit' | 'delivered', eta: string | null, delivered_at: string | null, note: string }`
  - `StubTrackingProvider` — deterministic: transit time = `2 + (hash(awb) % 5)` days from `dispatchedAt` (or a hash-derived pseudo start when null)
  - `GET /tracking/:awb` → looks up the sample by awb for `dispatched_at`, returns `TrackingInfo`

- [ ] **Step 1: Write the failing tests** `api/test/stats-tracking.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';
import { StubTrackingProvider } from '../src/lib/tracking.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY);

describe('tracking stub', () => {
  const stub = new StubTrackingProvider();

  it('is deterministic for the same awb', () => {
    const d = new Date('2026-07-01T00:00:00Z');
    const now = new Date('2026-07-02T00:00:00Z');
    const a = stub.track('9620551651', d, now);
    const b = stub.track('9620551651', d, now);
    expect(a).toEqual(b);
  });

  it('delivers after the transit window', () => {
    const d = new Date('2026-06-01T00:00:00Z');
    const now = new Date('2026-07-01T00:00:00Z'); // 30 days later, max transit is 6
    const info = stub.track('1042774655', d, now);
    expect(info.status).toBe('delivered');
    expect(info.delivered_at).toBeTruthy();
  });

  it('is in transit right after dispatch with an eta', () => {
    const d = new Date('2026-07-01T00:00:00Z');
    const now = new Date('2026-07-01T12:00:00Z');
    const info = stub.track('4720858811', d, now);
    expect(info.status).toBe('in_transit');
    expect(info.eta).toBeTruthy();
  });
});

describe('endpoints', () => {
  it('GET /tracking/:awb works for unknown awb too', async () => {
    const res = await auth(request(app).get('/tracking/whatever123'));
    expect(res.status).toBe(200);
    expect(['in_transit', 'delivered']).toContain(res.body.status);
  });

  it('GET /stats returns tile payload', async () => {
    await auth(request(app).post('/samples')).send({ sample_type: 'offer', quality: 'AA', receiver: 'X', deadline: '2026-01-01' });
    const s = await auth(request(app).post('/samples')).send({ sample_type: 'pss', quality: 'AAA', receiver: 'Y' });
    await auth(request(app).patch(`/samples/${s.body.id}`)).send({ status: 'dispatched', courier: 'dhl', awb: 'ABC1' });
    const res = await auth(request(app).get('/stats'));
    expect(res.body.by_status.requested).toBe(1);
    expect(res.body.in_transit).toBe(1);
    expect(res.body.overdue).toBe(1);
    expect(res.body.dispatched_this_week).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd api && npm test -- stats-tracking`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement.** `api/src/lib/tracking.ts`:

```ts
export type TrackingInfo = {
  awb: string;
  status: 'in_transit' | 'delivered';
  eta: string | null;
  delivered_at: string | null;
  note: string;
};

export interface TrackingProvider {
  track(awb: string, dispatchedAt: Date | null, now?: Date): TrackingInfo;
}

function hashAwb(awb: string): number {
  let h = 0;
  for (const c of awb) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const DAY = 86_400_000;

export class StubTrackingProvider implements TrackingProvider {
  track(awb: string, dispatchedAt: Date | null, now: Date = new Date()): TrackingInfo {
    const h = hashAwb(awb);
    const transitDays = 2 + (h % 5); // 2..6 days, stable per AWB
    const start = dispatchedAt ?? new Date(now.getTime() - (h % 10) * DAY);
    const arrival = new Date(start.getTime() + transitDays * DAY);
    if (now.getTime() >= arrival.getTime()) {
      return { awb, status: 'delivered', eta: null, delivered_at: arrival.toISOString(),
               note: `Delivered after ${transitDays} days in transit (stub data)` };
    }
    const daysLeft = Math.ceil((arrival.getTime() - now.getTime()) / DAY);
    return { awb, status: 'in_transit', eta: arrival.toISOString(), delivered_at: null,
             note: `In transit, ~${daysLeft} day(s) to arrival (stub data)` };
  }
}
```

`api/src/routes/tracking.ts`:

```ts
import { Router } from 'express';
import { pool } from '../db.js';
import { h } from '../errors.js';
import { StubTrackingProvider } from '../lib/tracking.js';

export const tracking = Router();
const provider = new StubTrackingProvider();

tracking.get('/:awb', h(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT dispatched_at FROM samples WHERE awb = $1 ORDER BY dispatched_at DESC NULLS LAST LIMIT 1`,
    [req.params.awb]
  );
  const dispatchedAt = rows[0]?.dispatched_at ? new Date(rows[0].dispatched_at) : null;
  res.json(provider.track(req.params.awb, dispatchedAt));
}));
```

`api/src/routes/stats.ts`:

```ts
import { Router } from 'express';
import { pool } from '../db.js';
import { h } from '../errors.js';

export const stats = Router();

stats.get('/', h(async (_req, res) => {
  const byStatus = await pool.query(`SELECT status, count(*)::int AS n FROM samples GROUP BY status`);
  const scalars = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM samples
        WHERE status IN ('requested','preparing')
          AND (deadline < CURRENT_DATE OR (deadline IS NULL AND coalesce(requested_at, created_at) < now() - interval '3 days'))) AS overdue,
      (SELECT count(*)::int FROM samples WHERE status = 'dispatched') AS in_transit,
      (SELECT count(*)::int FROM samples WHERE status = 'delivered' AND result IS NULL) AS awaiting_results,
      (SELECT count(*)::int FROM samples WHERE dispatched_at >= date_trunc('week', now())) AS dispatched_this_week
  `);
  const by_status: Record<string, number> = {};
  for (const r of byStatus.rows) by_status[r.status] = r.n;
  res.json({ by_status, ...scalars.rows[0] });
}));
```

Mount both in `api/src/app.ts`:

```ts
import { stats } from './routes/stats.js';
import { tracking } from './routes/tracking.js';
// ...
app.use('/stats', stats);
app.use('/tracking', tracking);
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd api && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api
git commit -m "feat(api): stats tiles + deterministic courier tracking stub"
```

---

### Task 6: Chaser digest computation + endpoints

**Files:**
- Create: `api/src/lib/digest.ts`, `api/src/routes/chaser.ts`
- Modify: `api/src/app.ts` (mount `/chaser`)
- Test: `api/test/chaser.test.ts`

**Interfaces:**
- Produces:
  - `computeDigest(): Promise<Digest>` where `Digest = { generated_at: string, buckets: { not_dispatched: Bucket, no_delivery_confirmation: Bucket, awaiting_results: Bucket } }` and `Bucket = { count: number, items: SampleSummary[] }` (items capped at 50, PSS first then by deadline); `SampleSummary = { id, ref, sample_type, quality, receiver, deadline, awb, dispatched_at, delivered_at }`
  - `POST /chaser/run` → computes, persists to `chaser_digests`, writes a `chased` event per listed item, returns the digest
  - `GET /chaser/digest` → most recent persisted digest or 404

- [ ] **Step 1: Write the failing tests** `api/test/chaser.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';
import { pool } from '../src/db.js';

beforeAll(async () => {
  await resetDb();
  const auth = (r: request.Test) => r.set('x-api-key', API_KEY);
  // overdue undispatched offer
  await auth(request(app).post('/samples')).send({ sample_type: 'offer', quality: 'AB FAQ', receiver: 'Edmax', deadline: '2026-01-01' });
  // overdue undispatched PSS (must sort before the offer)
  await auth(request(app).post('/samples')).send({ sample_type: 'pss', quality: 'AAA Nespresso', receiver: 'Nestrade', deadline: '2026-06-01' });
  // stale dispatched
  const d = await auth(request(app).post('/samples')).send({ sample_type: 'type', quality: 'ABC FAQ', receiver: 'Beyers' });
  await auth(request(app).patch(`/samples/${d.body.id}`)).send({ status: 'dispatched', courier: 'dhl', awb: 'OLD1' });
  await pool.query(`UPDATE samples SET dispatched_at = now() - interval '10 days' WHERE id = $1`, [d.body.id]);
  // delivered awaiting results
  const r = await auth(request(app).post('/samples')).send({ sample_type: 'offer', quality: 'PB', receiver: 'Key Coffee' });
  await auth(request(app).patch(`/samples/${r.body.id}`)).send({ status: 'delivered' });
  await pool.query(`UPDATE samples SET delivered_at = now() - interval '10 days' WHERE id = $1`, [r.body.id]);
});

const auth = (r: request.Test) => r.set('x-api-key', API_KEY);

describe('chaser', () => {
  it('404s before any digest exists', async () => {
    const res = await auth(request(app).get('/chaser/digest'));
    expect(res.status).toBe(404);
  });

  it('computes buckets with PSS first', async () => {
    const res = await auth(request(app).post('/chaser/run'));
    expect(res.status).toBe(200);
    const b = res.body.buckets;
    expect(b.not_dispatched.count).toBe(2);
    expect(b.not_dispatched.items[0].sample_type).toBe('pss');
    expect(b.no_delivery_confirmation.count).toBe(1);
    expect(b.awaiting_results.count).toBe(1);
  });

  it('persists the digest and writes chased events', async () => {
    const res = await auth(request(app).get('/chaser/digest'));
    expect(res.status).toBe(200);
    expect(res.body.buckets.not_dispatched.count).toBe(2);
    const ev = await pool.query(`SELECT count(*)::int AS n FROM sample_events WHERE type = 'chased'`);
    expect(ev.rows[0].n).toBe(4);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd api && npm test -- chaser`
Expected: FAIL — 404s.

- [ ] **Step 3: Implement.** `api/src/lib/digest.ts`:

```ts
import { pool } from '../db.js';

const SUMMARY = `id, ref, sample_type, quality, receiver, deadline, awb, dispatched_at, delivered_at`;
const PSS_FIRST = `ORDER BY (sample_type = 'pss') DESC, deadline ASC NULLS LAST, coalesce(requested_at, created_at) ASC LIMIT 50`;

export type Digest = {
  generated_at: string;
  buckets: Record<'not_dispatched' | 'no_delivery_confirmation' | 'awaiting_results',
    { count: number; items: Record<string, unknown>[] }>;
};

async function bucket(whereSql: string): Promise<{ count: number; items: Record<string, unknown>[] }> {
  const count = await pool.query(`SELECT count(*)::int AS n FROM samples WHERE ${whereSql}`);
  const items = await pool.query(`SELECT ${SUMMARY} FROM samples WHERE ${whereSql} ${PSS_FIRST}`);
  return { count: count.rows[0].n, items: items.rows };
}

export async function computeDigest(): Promise<Digest> {
  return {
    generated_at: new Date().toISOString(),
    buckets: {
      not_dispatched: await bucket(
        `status IN ('requested','preparing') AND (deadline < CURRENT_DATE OR (deadline IS NULL AND coalesce(requested_at, created_at) < now() - interval '3 days'))`),
      no_delivery_confirmation: await bucket(
        `status = 'dispatched' AND dispatched_at < now() - interval '5 days'`),
      awaiting_results: await bucket(
        `status = 'delivered' AND result IS NULL AND delivered_at < now() - interval '7 days'`),
    },
  };
}
```

`api/src/routes/chaser.ts`:

```ts
import { Router } from 'express';
import { pool } from '../db.js';
import { h, HttpError } from '../errors.js';
import { actorFrom } from '../auth.js';
import { computeDigest } from '../lib/digest.js';
import { addEvent } from '../lib/events.js';

export const chaser = Router();

chaser.post('/run', h(async (req, res) => {
  const digest = await computeDigest();
  await pool.query(`INSERT INTO chaser_digests (payload) VALUES ($1)`, [JSON.stringify(digest)]);
  const actor = actorFrom(req) === 'api' ? 'job:chaser' : actorFrom(req);
  for (const [name, b] of Object.entries(digest.buckets)) {
    for (const item of b.items) {
      await addEvent(String(item.id), 'chased', `flagged in digest bucket: ${name}`, actor);
    }
  }
  res.json(digest);
}));

chaser.get('/digest', h(async (_req, res) => {
  const { rows } = await pool.query(`SELECT payload FROM chaser_digests ORDER BY created_at DESC LIMIT 1`);
  if (!rows[0]) throw new HttpError(404, 'no digest yet');
  res.json(rows[0].payload);
}));
```

Mount in `api/src/app.ts`: `app.use('/chaser', chaser);`

- [ ] **Step 4: Run tests to verify pass**

Run: `cd api && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api
git commit -m "feat(api): chaser digest computation, persistence, chased events"
```

---

### Task 7: Seed parsers (pure functions + unit tests)

**Files:**
- Create: `scripts/package.json`, `scripts/tsconfig.json`
- Create: `scripts/seed/parsers.ts`
- Test: `scripts/seed/parsers.test.ts`

**Interfaces:**
- Produces (all exported from `scripts/seed/parsers.ts`; the runner in Task 8 imports exactly these):
  - `parseQtyGrams(raw: unknown): number | null`
  - `normalizeCourier(raw: unknown): string | null` (returns enum value or null)
  - `classifySampleType(raw: unknown): { type: string; shipmentMonth: string | null }`
  - `parseSheetDate(v: unknown): Date | null`
  - `normalizeName(s: string): string` (dedupe key: trim, collapse spaces, lowercase)
  - `parseResult(raw: unknown): string | null`

- [ ] **Step 1: Scaffold.** `scripts/package.json`:

```json
{
  "name": "sucafina-seed",
  "private": true,
  "type": "module",
  "scripts": {
    "seed": "tsx seed/run.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "pg": "^8.12.0",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/pg": "^8.11.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`scripts/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["seed"]
}
```

Run: `cd scripts && npm install`

- [ ] **Step 2: Write the failing tests** `scripts/seed/parsers.test.ts` — every fixture below is a REAL value from the workbook:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseQtyGrams, normalizeCourier, classifySampleType, parseSheetDate, normalizeName, parseResult,
} from './parsers.js';

describe('parseQtyGrams', () => {
  it.each([
    ['200', 200], ['1KG', 1000], ['1 KG', 1000], ['2KG', 2000], ['500g', 500],
    ['350G', 350], ['60+ROAST', 60], ['201', 201], [300, 300],
  ])('%s -> %s', (raw, expected) => expect(parseQtyGrams(raw)).toBe(expected));
  it.each([[null, null], ['', null], ['HD', null]])('%s -> null', (raw, expected) =>
    expect(parseQtyGrams(raw)).toBe(expected));
});

describe('normalizeCourier', () => {
  it.each([
    ['DHL', 'dhl'], ['dhl', 'dhl'], ['DHL ', 'dhl'],
    ['FedEX', 'fedex'], ['Fedex', 'fedex'], ['fedex', 'fedex'],
    ['UPS', 'ups'],
    ['KIPTOO', 'rider'], ['Kiptoo', 'rider'], ['Rider', 'rider'], ['rider', 'rider'],
    ['HD', 'hand_delivery'], ['H/D', 'hand_delivery'], ['By Hand', 'hand_delivery'], ['hd', 'hand_delivery'],
    ['Picked by Client', 'client_pickup'],
    ['wellsfargo', 'other'], ['Wells Fargo', 'other'], ['SGS Kenya', 'other'], ['Fargo', 'other'],
  ])('%s -> %s', (raw, expected) => expect(normalizeCourier(raw)).toBe(expected));
  it('null for empty', () => expect(normalizeCourier(null)).toBeNull());
});

describe('classifySampleType', () => {
  it.each([
    ['Offer Sample', 'offer', null],
    ['Offer sample', 'offer', null],
    ['Offer Sample (Onbehalf of Vava)', 'offer', null],
    ['TYPE SAMPLE', 'type', null],
    ['Type sample', 'type', null],
    ['PSS JUNE SHIPMENT', 'pss', 'June'],
    ['PSS April shipment', 'pss', 'April'],
    ['PSS Dec Shipment', 'pss', 'December'],
    ['PSS AUGUST SHIPMENT', 'pss', 'August'],
    ['WOC samples', 'woc', null],
    ['flavor mapping', 'flavor_mapping', null],
    ['Marketing sample', 'marketing', null],
    ['Calibration Sample(On behalf of X)', 'calibration', null],
    ['Retention', 'retention', null],
    ['whatever else', 'other', null],
    [null, 'other', null],
  ])('%s -> %s / %s', (raw, type, month) => {
    const r = classifySampleType(raw);
    expect(r.type).toBe(type);
    expect(r.shipmentMonth).toBe(month);
  });
});

describe('parseSheetDate', () => {
  it('passes Date instances through', () => {
    const d = new Date('2026-06-11T00:00:00Z');
    expect(parseSheetDate(d)).toEqual(d);
  });
  it('parses dd/mm/yyyy strings', () => {
    expect(parseSheetDate('14/1/2025')?.toISOString().slice(0, 10)).toBe('2025-01-14');
    expect(parseSheetDate('31/07/2025')?.toISOString().slice(0, 10)).toBe('2025-07-31');
  });
  it('parses iso-ish strings', () => {
    expect(parseSheetDate('2025-09-01 00:00:00')?.toISOString().slice(0, 10)).toBe('2025-09-01');
  });
  it('null for junk', () => {
    expect(parseSheetDate('SL-7346')).toBeNull();
    expect(parseSheetDate(null)).toBeNull();
  });
});

describe('normalizeName', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalizeName('  Beyers   Koffie ')).toBe('beyers koffie');
  });
});

describe('parseResult', () => {
  it.each([
    ['Approved', 'approved'], ['Rejected', 'rejected'], ['300', null], [null, null],
  ])('%s -> %s', (raw, expected) => expect(parseResult(raw)).toBe(expected));
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd scripts && npm test`
Expected: FAIL — `./parsers.js` not found.

- [ ] **Step 4: Implement `scripts/seed/parsers.ts`**:

```ts
export function parseQtyGrams(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Math.round(raw);
  const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)\s*(kg|g)?/i);
  if (!m || m[1] === undefined) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  return (m[2] ?? '').toLowerCase() === 'kg' ? Math.round(n * 1000) : Math.round(n);
}

export function normalizeCourier(raw: unknown): string | null {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (s.includes('dhl')) return 'dhl';
  if (s.includes('fedex') || s.includes('fed ex')) return 'fedex';
  if (s.includes('ups')) return 'ups';
  if (s.includes('kiptoo') || s.includes('rider')) return 'rider';
  if (s === 'hd' || s === 'h/d' || s.includes('hand')) return 'hand_delivery';
  if (s.includes('picked')) return 'client_pickup';
  return 'other';
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function classifySampleType(raw: unknown): { type: string; shipmentMonth: string | null } {
  if (raw == null) return { type: 'other', shipmentMonth: null };
  const s = String(raw).toLowerCase();
  let shipmentMonth: string | null = null;
  for (const m of MONTHS) {
    const abbr = m.slice(0, 3).toLowerCase();
    if (new RegExp(`\\b${abbr}[a-z]*\\b`).test(s)) { shipmentMonth = m; break; }
  }
  if (s.includes('pss')) return { type: 'pss', shipmentMonth };
  if (s.includes('type')) return { type: 'type', shipmentMonth: null };
  if (s.includes('offer')) return { type: 'offer', shipmentMonth: null };
  if (s.includes('woc')) return { type: 'woc', shipmentMonth: null };
  if (s.includes('flavor') || s.includes('flavour')) return { type: 'flavor_mapping', shipmentMonth: null };
  if (s.includes('marketing')) return { type: 'marketing', shipmentMonth: null };
  if (s.includes('calibration')) return { type: 'calibration', shipmentMonth: null };
  if (s.includes('retention')) return { type: 'retention', shipmentMonth: null };
  return { type: 'other', shipmentMonth: null };
}

export function parseSheetDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (v == null) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return null;
}

export function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseResult(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'approved') return 'approved';
  if (s === 'rejected') return 'rejected';
  return null;
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd scripts && npm test`
Expected: PASS (all parser cases).

- [ ] **Step 6: Commit**

```bash
git add scripts
git commit -m "feat(seed): tolerant parsers for qty, courier, sample type, dates"
```

---

### Task 8: Seed runner — xlsx → Postgres

**Files:**
- Create: `scripts/seed/run.ts`

**Interfaces:**
- Consumes: parsers from Task 7; schema from Task 2. Reads `docs/Sample Chaser2025-2026 - Sample Chaser.xlsx` (path relative to repo root; header row 1 on all three sheets; Client Details has the client name in column A under an EMPTY header cell).
- Produces: populated `clients`, `client_contacts`, `samples`, `sample_events` tables; updated `ref_counters`; `scripts/seed-report.json`. Column order facts (0-indexed): **Specialty** `0 Date, 1 REF, 2 Outturn, 3 Name, 4 GRADE, 5 Bags, 6 Description, 7 Receiver/Company, 8 AWB#, 9 Courier, 10 Qty, 11 Delivery date, 12 Result, 13 Comments, 14 Crop Year`; **Bulk** `0 Date, 1 Sample Ref, 2 Bags, 3 Quality, 4 Client Ref, 5 ICO Mark, 6 Sample Type, 7 Client, 8 Country, 9 AWB#, 10 Courier, 11 Qty, 12 Moisture, 13 Water Activity, 14 Delivery date, 15 Result, 16 Comments, 17 Crop Year`.

- [ ] **Step 1: Write `scripts/seed/run.ts`**:

```ts
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import pg from 'pg';
import {
  parseQtyGrams, normalizeCourier, classifySampleType, parseSheetDate, normalizeName, parseResult,
} from './parsers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const XLSX_PATH = path.resolve(__dirname, '../../docs/Sample Chaser2025-2026 - Sample Chaser.xlsx');
const DB_URL = process.env.DATABASE_URL ?? 'postgres://sucafina:sucafina@localhost:5433/sucafina';

type Row = unknown[];
const warnings: { sheet: string; row: number; reason: string }[] = [];
const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
const rowsOf = (name: string): Row[] =>
  XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], { header: 1, defval: null });

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();

// wipe previously seeded data (idempotent reruns) but keep agent-created rows intact on --keep
if (!process.argv.includes('--keep')) {
  await client.query(`TRUNCATE sample_events, samples, client_contacts, clients RESTART IDENTITY CASCADE`);
}

// ---- 1. clients -------------------------------------------------------
const clientRows = rowsOf('Client Details').slice(1).filter((r) => str(r[0]));
const clientIdByKey = new Map<string, string>();
let contactCount = 0;
for (const r of clientRows) {
  const name = String(str(r[0]));
  const key = normalizeName(name);
  let id = clientIdByKey.get(key);
  if (!id) {
    const ins = await client.query(
      `INSERT INTO clients (name) VALUES ($1) RETURNING id`, [name.trim().replace(/\s+/g, ' ')]);
    id = ins.rows[0].id as string;
    clientIdByKey.set(key, id);
  }
  if (str(r[1]) || str(r[2]) || str(r[3]) || str(r[4])) {
    await client.query(
      `INSERT INTO client_contacts (client_id, attention_to, full_address, phone, email) VALUES ($1,$2,$3,$4,$5)`,
      [id, str(r[1]), str(r[2]), str(r[3]), str(r[4])]);
    contactCount++;
  }
}

function resolveClient(receiver: string | null): string | null {
  if (!receiver) return null;
  const key = normalizeName(receiver);
  if (clientIdByKey.has(key)) return clientIdByKey.get(key)!;
  if (key.length < 4) return null;
  for (const [k, id] of clientIdByKey) {
    if (k.includes(key) || key.includes(k)) return id;
  }
  return null;
}

// ---- 2. samples -------------------------------------------------------
type Prepared = Record<string, unknown>;
let loaded = 0;

async function insertSample(p: Prepared, sheet: string, rowNum: number) {
  try {
    const ins = await client.query(
      `INSERT INTO samples (ref, ref_raw, source_sheet, sample_type, shipment_month, quality, grade,
         outturn, mark_name, ico_mark, client_ref, bags, qty_grams, qty_raw, moisture, water_activity,
         client_id, receiver, status, courier, courier_raw, awb,
         requested_at, dispatched_at, delivered_at, result, comments, crop_year)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       RETURNING id`,
      [p.ref, p.ref_raw, sheet, p.sample_type, p.shipment_month, p.quality, p.grade,
       p.outturn, p.mark_name, p.ico_mark, p.client_ref, p.bags, p.qty_grams, p.qty_raw, p.moisture, p.water_activity,
       p.client_id, p.receiver, p.status, p.courier, p.courier_raw, p.awb,
       p.requested_at, p.dispatched_at, p.delivered_at, p.result, p.comments, p.crop_year]);
    const id = ins.rows[0].id;
    await client.query(
      `INSERT INTO sample_events (sample_id, type, note, actor, created_at) VALUES ($1,'requested','imported from Sample Chaser','seed', $2)`,
      [id, p.requested_at ?? new Date()]);
    if (p.status !== 'requested') {
      await client.query(
        `INSERT INTO sample_events (sample_id, type, note, actor, created_at) VALUES ($1,'dispatched',$2,'seed',$3)`,
        [id, `via ${p.courier_raw ?? '?'} AWB ${p.awb ?? '—'}`, p.dispatched_at ?? p.requested_at ?? new Date()]);
    }
    loaded++;
  } catch (e) {
    warnings.push({ sheet, row: rowNum, reason: (e as Error).message.slice(0, 200) });
  }
}

function inferStatus(result: string | null, deliveredAt: Date | null, awb: string | null, courier: string | null) {
  if (result) return 'results_in';
  if (deliveredAt) return 'delivered';
  if (awb || courier) return 'dispatched';
  return 'requested';
}

// Specialty sheet
const spec = rowsOf('Specialty Samples 2024-2025');
for (let i = 1; i < spec.length; i++) {
  const r = spec[i];
  if (!r || !r.some((v) => str(v))) continue;
  const requestedAt = parseSheetDate(r[0]);
  const deliveredAt = parseSheetDate(r[11]);
  const result = parseResult(r[12]);
  const awb = str(r[8]);
  const courier = normalizeCourier(r[9]);
  const st = classifySampleType(r[6]);
  await insertSample({
    ref: null, ref_raw: str(r[1]), sample_type: st.type, shipment_month: st.shipmentMonth,
    quality: str(r[4]) && str(r[3]) ? `${str(r[4])} ${str(r[3])}` : str(r[4]) ?? str(r[3]),
    grade: str(r[4]), outturn: str(r[2]), mark_name: str(r[3]), ico_mark: null, client_ref: null,
    bags: typeof r[5] === 'number' ? Math.round(r[5]) : null,
    qty_grams: parseQtyGrams(r[10]), qty_raw: str(r[10]), moisture: null, water_activity: null,
    client_id: resolveClient(str(r[7])), receiver: str(r[7]),
    status: inferStatus(result, deliveredAt, awb, courier),
    courier, courier_raw: str(r[9]), awb,
    requested_at: requestedAt, dispatched_at: awb || courier ? requestedAt : null, delivered_at: deliveredAt,
    result, comments: str(r[13]), crop_year: str(r[14]),
  }, 'specialty', i + 1);
}

// Bulk sheet
const bulk = rowsOf('BulkSamples 2024-2025');
for (let i = 1; i < bulk.length; i++) {
  const r = bulk[i];
  if (!r || !r.some((v) => str(v))) continue;
  const requestedAt = parseSheetDate(r[0]);
  const deliveredAt = parseSheetDate(r[14]);
  const result = parseResult(r[15]);
  const awb = str(r[9]);
  const courier = normalizeCourier(r[10]);
  const st = classifySampleType(r[6]);
  await insertSample({
    ref: null, ref_raw: str(r[1]), sample_type: st.type, shipment_month: st.shipmentMonth,
    quality: str(r[3]), grade: null, outturn: null, mark_name: null,
    ico_mark: str(r[5]), client_ref: str(r[4]),
    bags: typeof r[2] === 'number' ? Math.round(r[2]) : null,
    qty_grams: parseQtyGrams(r[11]), qty_raw: str(r[11]),
    moisture: str(r[12]), water_activity: str(r[13]),
    client_id: resolveClient(str(r[7])), receiver: str(r[7]),
    status: inferStatus(result, deliveredAt, awb, courier),
    courier, courier_raw: str(r[10]), awb,
    requested_at: requestedAt, dispatched_at: awb || courier ? requestedAt : null, delivered_at: deliveredAt,
    result, comments: str(r[16]), crop_year: str(r[17]),
  }, 'bulk', i + 1);
}

// ---- 3. ref counters above any seeded numeric refs --------------------
for (const [prefix, floor] of [['SL', 8000], ['TYPE', 1000], ['SSKE', 108000]] as const) {
  const { rows } = await client.query(
    `SELECT max((regexp_match(ref_raw, '^${prefix}[\\s-]*([0-9]+)', 'i'))[1]::int) AS m FROM samples WHERE ref_raw ~* '^${prefix}'`);
  const next = Math.max(floor, (rows[0].m ?? 0) + 1);
  await client.query(`UPDATE ref_counters SET next_val = $2 WHERE prefix = $1`, [prefix, next]);
}

// ---- 4. report --------------------------------------------------------
const counts = await client.query(`
  SELECT (SELECT count(*)::int FROM clients) AS clients,
         (SELECT count(*)::int FROM client_contacts) AS contacts,
         (SELECT count(*)::int FROM samples) AS samples,
         (SELECT count(*)::int FROM samples WHERE client_id IS NOT NULL) AS resolved`);
const report = { ...counts.rows[0], contact_rows: contactCount, loaded, warnings: warnings.length, details: warnings };
writeFileSync(path.resolve(__dirname, '../seed-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, details: undefined }, null, 2));
await client.end();
```

- [ ] **Step 2: Run the seed against the dev DB**

Run: `cd scripts && npm run seed`
Expected output (approximately — assert these floors): `clients` ≈ 270 (260–280), `samples` ≥ 2,185 (95% of 2,300; target all 2,300), `warnings` < 115, `resolved` > 800. If `samples` is far below 2,185, open `scripts/seed-report.json` and fix the top recurring `reason` before proceeding.

- [ ] **Step 3: Spot-check via API**

Run (API running: `cd api && npm run dev` in another terminal):
`curl -s -H 'x-api-key: dev-key-sucafina' 'http://localhost:4000/stats' | python3 -m json.tool`
Expected: `by_status.dispatched` in the thousands, `awaiting_results` small, tiles all non-null.

Run: `curl -s -H 'x-api-key: dev-key-sucafina' 'http://localhost:4000/samples?q=beyers' | python3 -m json.tool | head -40`
Expected: the real Beyers type samples (AB FAQ / ABC FAQ / MBUNI HEAVY, AWB 9620551651) appear.

- [ ] **Step 4: Commit**

```bash
git add scripts
git commit -m "feat(seed): load Sample Chaser workbook into postgres with report"
```

---

### Task 9: Agent — API client + intake & client-book skills

**Files:**
- Create: `src/lib/api.ts`
- Create: `src/skills/tools/FindClientTool.ts`, `src/skills/tools/CreateSampleRequestTool.ts`, `src/skills/tools/UpsertClientTool.ts`
- Create: `src/skills/sample-intake.skill.ts`, `src/skills/client-book.skill.ts`
- Create: `.env` additions (root): `API_BASE_URL`, `API_KEY`
- Modify: `env.example`

**Interfaces:**
- Consumes: API endpoints from Tasks 3–4.
- Produces: `apiFetch(path: string, init?: RequestInit): Promise<any>`; tools `find_client`, `create_sample_request`, `upsert_client`; skills exported as `sampleIntakeSkill`, `clientBookSkill` (imported by `src/index.ts` in Task 11).

- [ ] **Step 1: Write `src/lib/api.ts`**:

```ts
import { env } from 'lua-cli';

export async function apiFetch(path: string, init: RequestInit = {}): Promise<any> {
  const base = env('API_BASE_URL') || 'http://localhost:4000';
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-api-key': env('API_KEY') || 'dev-key-sucafina',
      'x-actor': 'agent:chat',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Sample API error ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  return res.json();
}
```

- [ ] **Step 2: Write the tools.** `src/skills/tools/FindClientTool.ts`:

```ts
import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class FindClientTool implements LuaTool {
  name = 'find_client';
  description = 'Search the client address book by (partial) company name. Returns matches with ids.';

  inputSchema = z.object({
    query: z.string().describe('Partial or full client/company name, e.g. "beyers"'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const res = await apiFetch(`/clients?q=${encodeURIComponent(input.query)}`);
    return { matches: res.data.map((c: any) => ({ id: c.id, name: c.name, country: c.country })) };
  }
}
```

`src/skills/tools/CreateSampleRequestTool.ts`:

```ts
import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

const item = z.object({
  quality: z.string().describe('Coffee quality/description, e.g. "AB FAQ", "AA SANGALAI"'),
  sample_type: z.enum(['offer', 'type', 'pss', 'woc', 'retention', 'flavor_mapping', 'marketing', 'calibration', 'other'])
    .describe('Kind of sample'),
  qty_grams: z.number().int().optional().describe('Quantity in grams; defaults: offer 200, type 300, pss 1000'),
  grade: z.string().optional().describe('Grade if stated, e.g. AA, AB, PB'),
  roast_instructions: z.string().optional(),
});

const DEFAULT_QTY: Record<string, number> = { offer: 200, type: 300, pss: 1000 };

export default class CreateSampleRequestTool implements LuaTool {
  name = 'create_sample_request';
  description = 'Log one or more sample requests (one record per sample). Returns issued refs.';

  inputSchema = z.object({
    items: z.array(item).min(1),
    client_id: z.string().optional().describe('Client id from find_client, when resolved'),
    receiver: z.string().describe('Receiver/company name as stated, e.g. "Thomas Pitault at Beyers"'),
    requester: z.string().optional().describe('Who asked, e.g. "Omar"'),
    deadline: z.string().optional().describe('ISO date YYYY-MM-DD if a deadline was given'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const created = [];
    for (const it of input.items) {
      const row = await apiFetch('/samples', {
        method: 'POST',
        body: JSON.stringify({
          sample_type: it.sample_type,
          quality: it.quality,
          grade: it.grade ?? null,
          qty_grams: it.qty_grams ?? DEFAULT_QTY[it.sample_type] ?? null,
          roast_instructions: it.roast_instructions ?? null,
          client_id: input.client_id ?? null,
          receiver: input.receiver,
          requester: input.requester ?? null,
          deadline: input.deadline ?? null,
        }),
      });
      created.push({ ref: row.ref, quality: row.quality, qty_grams: row.qty_grams, status: row.status });
    }
    return { created };
  }
}
```

`src/skills/tools/UpsertClientTool.ts`:

```ts
import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class UpsertClientTool implements LuaTool {
  name = 'upsert_client';
  description = 'Add a new client or add a contact/address to an existing one.';

  inputSchema = z.object({
    name: z.string().describe('Company name'),
    country: z.string().optional(),
    attention_to: z.string().optional().describe('Contact person'),
    full_address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const contact = input.attention_to || input.full_address || input.phone || input.email
      ? { attention_to: input.attention_to, full_address: input.full_address, phone: input.phone, email: input.email }
      : null;
    return apiFetch('/clients', {
      method: 'POST',
      body: JSON.stringify({ name: input.name, country: input.country ?? null, contact }),
    });
  }
}
```

- [ ] **Step 3: Write the skills.** `src/skills/sample-intake.skill.ts`:

```ts
import { LuaSkill } from 'lua-cli';
import FindClientTool from './tools/FindClientTool';
import CreateSampleRequestTool from './tools/CreateSampleRequestTool';

export const sampleIntakeSkill = new LuaSkill({
  name: 'sample-intake',
  description: 'Log new sample requests from traders',
  context: `Use when a trader asks to send/prepare samples for a client.
- Each distinct quality = one sample record. "AB FAQ, ABC FAQ and Heavy Mbuni to Beyers" = 3 records.
- ALWAYS call find_client first to resolve the company (use the company, not the person: "Thomas at Beyers" -> search "beyers"). Pass client_id when exactly one match; otherwise pass receiver as stated and mention you could not resolve the client.
- Required before creating: quality + sample type + receiver. If the sample type is unclear, ask ONE short question (e.g. "as Types?"). Do not ask about anything else — qty defaults by type (offer 200g, type 300g, PSS 1kg), deadline and roast instructions are optional.
- After creating, confirm compactly: one line per sample with ref, quality, qty, receiver, deadline.`,
  tools: [new FindClientTool(), new CreateSampleRequestTool()],
});
```

`src/skills/client-book.skill.ts`:

```ts
import { LuaSkill } from 'lua-cli';
import FindClientTool from './tools/FindClientTool';
import UpsertClientTool from './tools/UpsertClientTool';

export const clientBookSkill = new LuaSkill({
  name: 'client-book',
  description: 'Look up and maintain the client address book',
  context: `Use for "what's X's address", "add new client Y", "update Z's contact".
- find_client for lookups; upsert_client to add a company or attach a new contact/address.
- When reading back an address, give attention_to + full_address + phone in one compact block.`,
  tools: [new FindClientTool(), new UpsertClientTool()],
});
```

- [ ] **Step 4: Env plumbing.** Append to root `.env` (create if missing — it's gitignored):

```
API_BASE_URL=http://localhost:4000
API_KEY=dev-key-sucafina
```

Append the same two keys with placeholder values to `env.example`.

- [ ] **Step 5: Verify compile**

Run: `npx lua compile`
Expected: exit 0, tools/skills listed. (Skills aren't registered on the agent yet — that's Task 11; compile only validates modules.) If compile complains about unregistered skills, temporarily add `skills: [sampleIntakeSkill, clientBookSkill]` to `src/index.ts` now instead of Task 11.

- [ ] **Step 6: Commit**

```bash
git add src env.example
git commit -m "feat(agent): api client, intake + client-book skills"
```

---

### Task 10: Agent — dispatch, status/tracking, results skills

**Files:**
- Create: `src/skills/tools/FindOpenSamplesTool.ts`, `src/skills/tools/RecordDispatchTool.ts`, `src/skills/tools/SearchSamplesTool.ts`, `src/skills/tools/GetSampleStatusTool.ts`, `src/skills/tools/TrackAwbTool.ts`, `src/skills/tools/RecordResultTool.ts`, `src/skills/tools/ListAwaitingResultsTool.ts`
- Create: `src/skills/dispatch-logging.skill.ts`, `src/skills/status-and-tracking.skill.ts`, `src/skills/results-capture.skill.ts`

**Interfaces:**
- Consumes: `apiFetch`; API filters from Task 4/5.
- Produces: skills exported as `dispatchLoggingSkill`, `statusTrackingSkill`, `resultsCaptureSkill`.

- [ ] **Step 1: Write the tools.** `src/skills/tools/FindOpenSamplesTool.ts`:

```ts
import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class FindOpenSamplesTool implements LuaTool {
  name = 'find_open_samples';
  description = 'List samples not yet dispatched (status requested/preparing), optionally filtered by client/receiver text.';

  inputSchema = z.object({
    query: z.string().optional().describe('Client or receiver text, e.g. "beyers"'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const q = input.query ? `&q=${encodeURIComponent(input.query)}` : '';
    const res = await apiFetch(`/samples?status=requested,preparing${q}&pageSize=50`);
    return {
      total: res.total,
      samples: res.data.map((s: any) => ({
        id: s.id, ref: s.ref ?? s.ref_raw, quality: s.quality, receiver: s.receiver,
        sample_type: s.sample_type, deadline: s.deadline,
      })),
    };
  }
}
```

`src/skills/tools/RecordDispatchTool.ts`:

```ts
import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class RecordDispatchTool implements LuaTool {
  name = 'record_dispatch';
  description = 'Mark samples as dispatched with courier and AWB/tracking number.';

  inputSchema = z.object({
    sample_ids: z.array(z.string()).min(1).describe('Sample ids from find_open_samples'),
    courier: z.enum(['dhl', 'fedex', 'ups', 'rider', 'hand_delivery', 'client_pickup', 'other']),
    awb: z.string().optional().describe('Tracking/AWB number if there is one'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const updated = [];
    for (const id of input.sample_ids) {
      const row = await apiFetch(`/samples/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'dispatched', courier: input.courier, awb: input.awb ?? null }),
      });
      updated.push({ ref: row.ref ?? row.ref_raw, status: row.status, awb: row.awb });
    }
    return { updated };
  }
}
```

`src/skills/tools/SearchSamplesTool.ts`:

```ts
import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class SearchSamplesTool implements LuaTool {
  name = 'search_samples';
  description = 'Search sample records by text, status, type, or flags (overdue / awaiting results).';

  inputSchema = z.object({
    q: z.string().optional().describe('Text over ref/quality/receiver'),
    status: z.string().optional().describe('Comma list: requested,preparing,dispatched,delivered,results_in,cancelled'),
    sample_type: z.enum(['offer', 'type', 'pss', 'woc', 'retention', 'flavor_mapping', 'marketing', 'calibration', 'other']).optional(),
    overdue: z.boolean().optional(),
    awaiting_results: z.boolean().optional(),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const p = new URLSearchParams({ pageSize: '25' });
    if (input.q) p.set('q', input.q);
    if (input.status) p.set('status', input.status);
    if (input.sample_type) p.set('sample_type', input.sample_type);
    if (input.overdue) p.set('overdue', 'true');
    if (input.awaiting_results) p.set('awaiting_results', 'true');
    const res = await apiFetch(`/samples?${p}`);
    return {
      total: res.total,
      samples: res.data.map((s: any) => ({
        id: s.id, ref: s.ref ?? s.ref_raw, quality: s.quality, receiver: s.receiver,
        sample_type: s.sample_type, status: s.status, courier: s.courier, awb: s.awb,
        deadline: s.deadline, result: s.result,
      })),
    };
  }
}
```

`src/skills/tools/GetSampleStatusTool.ts`:

```ts
import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class GetSampleStatusTool implements LuaTool {
  name = 'get_sample_status';
  description = 'Full detail + event timeline for one sample by ref or id.';

  inputSchema = z.object({
    ref_or_id: z.string().describe('Sample ref like "SL-8000" or a uuid'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(input.ref_or_id);
    if (isUuid) return apiFetch(`/samples/${input.ref_or_id}`);
    const res = await apiFetch(`/samples?q=${encodeURIComponent(input.ref_or_id)}&pageSize=1`);
    if (!res.data[0]) return { found: false, message: `No sample matching "${input.ref_or_id}"` };
    return apiFetch(`/samples/${res.data[0].id}`);
  }
}
```

`src/skills/tools/TrackAwbTool.ts`:

```ts
import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class TrackAwbTool implements LuaTool {
  name = 'track_awb';
  description = 'Courier tracking status for an AWB/tracking number (prototype: simulated data).';

  inputSchema = z.object({
    awb: z.string().describe('AWB / tracking number'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    return apiFetch(`/tracking/${encodeURIComponent(input.awb)}`);
  }
}
```

`src/skills/tools/RecordResultTool.ts`:

```ts
import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class RecordResultTool implements LuaTool {
  name = 'record_result';
  description = 'Record the cupping/client outcome for a sample (approved/rejected + notes).';

  inputSchema = z.object({
    sample_id: z.string().describe('Sample id (resolve via search_samples / get_sample_status first)'),
    result: z.enum(['approved', 'rejected', 'pending_feedback']),
    cupping_notes: z.string().optional().describe('e.g. "83p, citrus driven, clean"'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const row = await apiFetch(`/samples/${input.sample_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ result: input.result, cupping_notes: input.cupping_notes ?? null }),
    });
    return { ref: row.ref ?? row.ref_raw, status: row.status, result: row.result, cupping_notes: row.cupping_notes };
  }
}
```

`src/skills/tools/ListAwaitingResultsTool.ts`:

```ts
import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

export default class ListAwaitingResultsTool implements LuaTool {
  name = 'list_awaiting_results';
  description = 'List delivered samples that still have no recorded result/feedback.';

  inputSchema = z.object({});

  async execute() {
    const res = await apiFetch('/samples?awaiting_results=true&pageSize=25');
    return {
      total: res.total,
      samples: res.data.map((s: any) => ({
        id: s.id, ref: s.ref ?? s.ref_raw, quality: s.quality, receiver: s.receiver, delivered_at: s.delivered_at,
      })),
    };
  }
}
```

- [ ] **Step 2: Write the skills.** `src/skills/dispatch-logging.skill.ts`:

```ts
import { LuaSkill } from 'lua-cli';
import FindOpenSamplesTool from './tools/FindOpenSamplesTool';
import RecordDispatchTool from './tools/RecordDispatchTool';

export const dispatchLoggingSkill = new LuaSkill({
  name: 'dispatch-logging',
  description: 'Record that samples were sent out (courier + AWB)',
  context: `Use when QC reports a dispatch, e.g. "dispatched samples to Key coffee tracking details :872526345980 Fedex".
- find_open_samples with the client name to locate what was pending.
- Exactly one plausible set -> record_dispatch on all of them. Multiple plausible sets or none -> ask ONE short question listing the candidates by ref.
- Courier words map: DHL->dhl, Fedex->fedex, UPS->ups, Kiptoo/rider->rider, HD/by hand->hand_delivery, picked by client->client_pickup.
- Confirm with refs + AWB in one line.`,
  tools: [new FindOpenSamplesTool(), new RecordDispatchTool()],
});
```

`src/skills/status-and-tracking.skill.ts`:

```ts
import { LuaSkill } from 'lua-cli';
import SearchSamplesTool from './tools/SearchSamplesTool';
import GetSampleStatusTool from './tools/GetSampleStatusTool';
import TrackAwbTool from './tools/TrackAwbTool';

export const statusTrackingSkill = new LuaSkill({
  name: 'status-and-tracking',
  description: 'Answer "did we send X / where is it / what is pending" questions',
  context: `Use for any status question from traders: "did the Folgers samples go out?", "AWB for the Beyers types?", "what's pending for Zoegas?".
- search_samples by client/quality text first; get_sample_status when they name a specific ref.
- If the record has an AWB and they ask where it is / will it arrive, call track_awb and give status + ETA. Say tracking is simulated in this prototype if asked.
- Answer with facts from the records only. If nothing is found, say so plainly — never guess.`,
  tools: [new SearchSamplesTool(), new GetSampleStatusTool(), new TrackAwbTool()],
});
```

`src/skills/results-capture.skill.ts`:

```ts
import { LuaSkill } from 'lua-cli';
import RecordResultTool from './tools/RecordResultTool';
import ListAwaitingResultsTool from './tools/ListAwaitingResultsTool';
import SearchSamplesTool from './tools/SearchSamplesTool';

export const resultsCaptureSkill = new LuaSkill({
  name: 'results-capture',
  description: 'Record cupping results and client feedback; list what is awaiting feedback',
  context: `Use when someone shares cupping notes or a client verdict, e.g. "PSS3 cupped 83, citrus driven, clean — approved".
- Resolve the sample with search_samples (by ref text or quality+client), then record_result.
- Scores/notes go in cupping_notes verbatim; result is approved/rejected/pending_feedback.
- "what's awaiting feedback?" -> list_awaiting_results.`,
  tools: [new RecordResultTool(), new ListAwaitingResultsTool(), new SearchSamplesTool()],
});
```

- [ ] **Step 3: Verify compile**

Run: `npx lua compile`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src
git commit -m "feat(agent): dispatch, status/tracking, results skills"
```

---

### Task 11: Agent — persona, chaser job, wiring

**Files:**
- Create: `src/persona.ts`, `src/jobs/daily-chaser.job.ts`
- Modify: `src/index.ts` (replace template persona, register skills + job)

**Interfaces:**
- Consumes: all five skills; `apiFetch`; `POST /chaser/run` from Task 6.
- Produces: fully wired `LuaAgent`; job `daily-chaser` (cron `0 6 * * 1-5`, `Africa/Nairobi`).

- [ ] **Step 1: Write `src/persona.ts`** (grounded in the real Teams chat — see `docs/Quality - Trade Teams Chat.docx`):

```ts
export const persona = `# Kenyacof Sample Desk

## Identity & Role
You are the sample-management coordinator for Sucafina Kenya's (Kenyacof) quality and trade team.
You are the reliable middle layer between traders who request samples and the QC/lab team in Thika
who prepares and dispatches them. You keep the sample log accurate so nobody has to chase.

## Business Context
Sucafina is a farm-to-roaster coffee trader. The Kenya team sends green and roasted coffee samples
to clients worldwide (roasters like Beyers, Folgers, Zoegas, Joh Johansson, Key Coffee; internal
offices like Sucafina NV and Sucafina Yunnan). Samples move via DHL/FedEx/UPS, a local rider
(Kiptoo), hand delivery, or client pickup.

## Who you talk to
- Traders (e.g. Ivo, Omar, Muki, Brian, Gloria): request samples, chase status, ask summaries.
- QC/lab (e.g. Bernard, Brillian, Harriet, Anička): report dispatches with AWB numbers, share
  cupping results.

## Tone
Chat-native and brief, like the team's own Teams messages. Warm-professional, no corporate fluff.
Confirmations are short: "Well noted", "Done", "Logged". Use their jargon naturally: PSS
(pre-shipment sample), Types, offer sample, FAQ, AWB, outturn, cupping, bulk. Never explain jargon
unless asked.

## Rules
- One record per sample. Confirm every action with a compact echo: ref • quality • qty • receiver
  • status (+ AWB when dispatched).
- If required info is missing, ask exactly ONE short question ("as Types?"). Use defaults instead
  of asking where possible: offer 200g, type 300g, PSS 1kg.
- PSS samples are high-stakes (they must match the shipment). Treat their deadlines and follow-ups
  as priority.
- Facts only. If the log doesn't know, say so; never invent AWBs, dates, or statuses. Tracking data
  in this prototype is simulated — say so if someone asks about accuracy.
- Keep replies under ~120 words unless someone asks for a summary/report.

## Boundaries
- You log and report; you don't negotiate prices, allocate stock, or approve shipments.
- Escalate to the team anything about claims, contract terms, or coffee availability.`;
```

- [ ] **Step 2: Write `src/jobs/daily-chaser.job.ts`**:

```ts
import { LuaJob, User, env } from 'lua-cli';
import { apiFetch } from '../lib/api';

function fmtItem(i: any): string {
  const bits = [i.ref ?? '(no ref)', i.quality, '→ ' + (i.receiver ?? '?')];
  if (i.deadline) bits.push(`deadline ${String(i.deadline).slice(0, 10)}`);
  if (i.awb) bits.push(`AWB ${i.awb}`);
  return '• ' + bits.filter(Boolean).join(' — ');
}

export const dailyChaserJob = new LuaJob({
  name: 'daily-chaser',
  description: 'Weekday-morning digest of samples that need chasing',
  schedule: { type: 'cron', expression: '0 6 * * 1-5', timezone: 'Africa/Nairobi' },
  execute: async () => {
    const digest = await apiFetch('/chaser/run', { method: 'POST', headers: { 'x-actor': 'job:chaser' } });
    const b = digest.buckets;
    const section = (title: string, bucket: any) =>
      `${title} (${bucket.count})\n${bucket.items.slice(0, 10).map(fmtItem).join('\n') || '• none 🎉'}`;
    const text = [
      `☕ Sample chaser — ${new Date().toDateString()}`,
      section('⏰ Not yet dispatched (past due)', b.not_dispatched),
      section('🚚 Dispatched, no delivery confirmation (>5d)', b.no_delivery_confirmation),
      section('📋 Delivered, awaiting results (>7d)', b.awaiting_results),
    ].join('\n\n');

    const userId = env('CHASER_USER_ID');
    if (userId) {
      const user = await User.get(userId);
      await user.send([{ type: 'text', text }]);
    }
    return {
      success: true,
      counts: {
        not_dispatched: b.not_dispatched.count,
        no_delivery_confirmation: b.no_delivery_confirmation.count,
        awaiting_results: b.awaiting_results.count,
      },
    };
  },
});
```

(`CHASER_USER_ID` is optional: without it the digest is still computed + persisted and shows on the dashboard's Chaser page; with it the agent proactively messages that user. Set it at demo time from a real chat user id visible in the Lua dashboard.)

- [ ] **Step 3: Rewrite `src/index.ts`** (replace the whole template file):

```ts
import { LuaAgent } from 'lua-cli';
import { persona } from './persona';
import { sampleIntakeSkill } from './skills/sample-intake.skill';
import { dispatchLoggingSkill } from './skills/dispatch-logging.skill';
import { statusTrackingSkill } from './skills/status-and-tracking.skill';
import { resultsCaptureSkill } from './skills/results-capture.skill';
import { clientBookSkill } from './skills/client-book.skill';
import { dailyChaserJob } from './jobs/daily-chaser.job';

const agent = new LuaAgent({
  name: 'Sample-management-agent',
  persona,
  model: 'anthropic/claude-sonnet-5',
  skills: [
    sampleIntakeSkill,
    dispatchLoggingSkill,
    statusTrackingSkill,
    resultsCaptureSkill,
    clientBookSkill,
  ],
  jobs: [dailyChaserJob],
});

async function main() {}

main().catch(console.error);
```

- [ ] **Step 4: Verify compile**

Run: `npx lua compile`
Expected: exit 0; 5 skills + 1 job listed.

- [ ] **Step 5: Local tool smoke test** (API + seeded DB running)

Run: `npx lua test` (interactive) — invoke `find_client` with `{"query": "beyers"}`.
Expected: matches include Beyers. If `lua test` executes tools in the Lua cloud sandbox rather than locally, `API_BASE_URL=http://localhost:4000` won't be reachable — in that case skip to Task 14 (tunnel) for behavior testing and rely on compile here.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "feat(agent): persona, daily chaser job, agent wiring"
```

---

### Task 12: Dashboard scaffold + API client + Samples page

**Files:**
- Create: `dashboard/` (Vite react-ts scaffold)
- Create: `dashboard/.env`, `dashboard/src/api.ts`, `dashboard/src/types.ts`
- Create: `dashboard/src/components/StatusBadge.tsx`, `dashboard/src/components/KpiTiles.tsx`
- Create: `dashboard/src/pages/SamplesPage.tsx`
- Modify: `dashboard/src/App.tsx`, `dashboard/src/main.tsx`, `dashboard/src/index.css`, `dashboard/index.html`

**Interfaces:**
- Consumes: all API endpoints; env `VITE_API_BASE`, `VITE_API_KEY`, `VITE_LUA_AGENT_ID`.
- Produces: `api<T>(path, init?)` fetch helper; `Sample`, `Client`, `Stats`, `Digest` types mirroring API payloads; routed app shell with nav (Samples / Clients / Chaser).

- [ ] **Step 1: Scaffold**

Run:
```bash
cd /Users/devashishthapliyal/Documents/work/Lua/Sucafina
npm create vite@latest dashboard -- --template react-ts
cd dashboard && npm install && npm install react-router-dom
```

`dashboard/.env`:

```
VITE_API_BASE=http://localhost:4000
VITE_API_KEY=dev-key-sucafina
VITE_LUA_AGENT_ID=baseAgent_agent_1783420556773_cc6qh9f2y
```

- [ ] **Step 2: Write `dashboard/src/api.ts`**:

```ts
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-api-key': import.meta.env.VITE_API_KEY,
      'x-actor': 'dashboard',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}
```

`dashboard/src/types.ts`:

```ts
export type SampleStatus = 'requested' | 'preparing' | 'dispatched' | 'delivered' | 'results_in' | 'cancelled';

export interface Sample {
  id: string;
  ref: string | null;
  ref_raw: string | null;
  sample_type: string;
  shipment_month: string | null;
  quality: string | null;
  grade: string | null;
  qty_grams: number | null;
  qty_raw: string | null;
  client_id: string | null;
  receiver: string | null;
  requester: string | null;
  deadline: string | null;
  roast_instructions: string | null;
  status: SampleStatus;
  courier: string | null;
  awb: string | null;
  requested_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  result: string | null;
  cupping_notes: string | null;
  comments: string | null;
}

export interface SampleEvent {
  id: string;
  type: string;
  note: string | null;
  actor: string;
  created_at: string;
}

export interface Client {
  id: string;
  name: string;
  country: string | null;
  contact_count?: number;
  contacts?: { id: string; attention_to: string | null; full_address: string | null; phone: string | null; email: string | null }[];
}

export interface Stats {
  by_status: Record<string, number>;
  overdue: number;
  in_transit: number;
  awaiting_results: number;
  dispatched_this_week: number;
}

export interface DigestBucket { count: number; items: (Sample & Record<string, unknown>)[] }
export interface Digest {
  generated_at: string;
  buckets: { not_dispatched: DigestBucket; no_delivery_confirmation: DigestBucket; awaiting_results: DigestBucket };
}

export interface ListResponse<T> { data: T[]; total: number; page?: number; pageSize?: number }
```

- [ ] **Step 3: App shell + styles.** Replace `dashboard/src/index.css`:

```css
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.5 -apple-system, 'Segoe UI', Roboto, sans-serif; background: #f6f7f9; color: #1a202c; }
nav { display: flex; gap: 4px; align-items: center; padding: 10px 20px; background: #1f2937; }
nav .brand { color: #fff; font-weight: 700; margin-right: 16px; }
nav a { color: #cbd5e1; text-decoration: none; padding: 6px 12px; border-radius: 6px; }
nav a.active, nav a:hover { background: #374151; color: #fff; }
main { max-width: 1200px; margin: 24px auto; padding: 0 20px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
.tile { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
.tile .num { font-size: 26px; font-weight: 700; }
.tile .label { color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-bottom: 16px; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eef1f4; white-space: nowrap; }
th { color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
tr.clickable:hover { background: #f8fafc; cursor: pointer; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.badge.requested { background: #fef3c7; color: #92400e; }
.badge.preparing { background: #e0e7ff; color: #3730a3; }
.badge.dispatched { background: #dbeafe; color: #1e40af; }
.badge.delivered { background: #d1fae5; color: #065f46; }
.badge.results_in { background: #dcfce7; color: #166534; }
.badge.cancelled { background: #f1f5f9; color: #64748b; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
input, select, textarea, button { font: inherit; padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; }
button.primary { background: #1f2937; color: #fff; border-color: #1f2937; cursor: pointer; }
form.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #64748b; }
.timeline li { margin-bottom: 6px; }
.muted { color: #94a3b8; }
h2 { margin: 4px 0 14px; }
```

Replace `dashboard/src/App.tsx`:

```tsx
import { NavLink, Route, Routes } from 'react-router-dom';
import SamplesPage from './pages/SamplesPage';

export default function App() {
  return (
    <>
      <nav>
        <span className="brand">☕ Sucafina Sample Desk</span>
        <NavLink to="/">Samples</NavLink>
        <NavLink to="/clients">Clients</NavLink>
        <NavLink to="/chaser">Chaser</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<SamplesPage />} />
        </Routes>
      </main>
    </>
  );
}
```

Replace `dashboard/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
```

Delete `dashboard/src/App.css` and remove its import if the scaffold added one.

- [ ] **Step 4: Components.** `dashboard/src/components/StatusBadge.tsx`:

```tsx
export default function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{status.replace('_', ' ')}</span>;
}
```

`dashboard/src/components/KpiTiles.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Stats } from '../types';

export default function KpiTiles({ refreshKey = 0 }: { refreshKey?: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => { api<Stats>('/stats').then(setStats).catch(console.error); }, [refreshKey]);
  if (!stats) return null;
  const tiles = [
    { label: 'Pending', num: (stats.by_status.requested ?? 0) + (stats.by_status.preparing ?? 0) },
    { label: 'In transit', num: stats.in_transit },
    { label: 'Awaiting results', num: stats.awaiting_results },
    { label: 'Overdue', num: stats.overdue },
    { label: 'Dispatched this week', num: stats.dispatched_this_week },
  ];
  return (
    <div className="tiles">
      {tiles.map((t) => (
        <div className="tile" key={t.label}>
          <div className="num">{t.num}</div>
          <div className="label">{t.label}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Samples page.** `dashboard/src/pages/SamplesPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { ListResponse, Sample } from '../types';
import KpiTiles from '../components/KpiTiles';
import StatusBadge from '../components/StatusBadge';

const STATUSES = ['', 'requested', 'preparing', 'dispatched', 'delivered', 'results_in', 'cancelled'];
const TYPES = ['', 'offer', 'type', 'pss', 'woc', 'retention', 'flavor_mapping', 'marketing', 'calibration', 'other'];

export default function SamplesPage() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<ListResponse<Sample> | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    if (type) p.set('sample_type', type);
    api<ListResponse<Sample>>(`/samples?${p}`).then(setRes).catch(console.error);
  }, [q, status, type, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <h2>Samples</h2>
      <KpiTiles />
      <div className="filters">
        <input placeholder="Search ref / quality / receiver…" value={q}
               onChange={(e) => { setPage(1); setQ(e.target.value); }} />
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s || 'any status'}</option>)}
        </select>
        <select value={type} onChange={(e) => { setPage(1); setType(e.target.value); }}>
          {TYPES.map((t) => <option key={t} value={t}>{t || 'any type'}</option>)}
        </select>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr><th>Ref</th><th>Type</th><th>Quality</th><th>Receiver</th><th>Status</th><th>Courier</th><th>AWB</th><th>Requested</th><th>Deadline</th></tr>
          </thead>
          <tbody>
            {res?.data.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => nav(`/samples/${s.id}`)}>
                <td>{s.ref ?? s.ref_raw ?? <span className="muted">—</span>}</td>
                <td>{s.sample_type}</td>
                <td>{s.quality}</td>
                <td>{s.receiver}</td>
                <td><StatusBadge status={s.status} /></td>
                <td>{s.courier ?? ''}</td>
                <td>{s.awb ?? ''}</td>
                <td>{s.requested_at?.slice(0, 10) ?? ''}</td>
                <td>{s.deadline?.slice(0, 10) ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          {res ? `${res.total} samples — page ${page}` : 'loading…'}
          {' '}
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>‹ prev</button>
          {' '}
          <button onClick={() => setPage(page + 1)} disabled={!res || page * 25 >= res.total}>next ›</button>
        </p>
      </div>
    </>
  );
}
```

- [ ] **Step 6: Verify**

Run: `cd dashboard && npm run build`
Expected: build succeeds.
Run: `npm run dev` and open http://localhost:5173 (API running, DB seeded).
Expected: KPI tiles show real numbers; table lists seeded samples; search "beyers" filters.

- [ ] **Step 7: Commit**

```bash
git add dashboard
git commit -m "feat(dashboard): scaffold, api client, samples table + KPI tiles"
```

---

### Task 13: Dashboard — sample detail/edit + clients + chaser pages + widget

**Files:**
- Create: `dashboard/src/pages/SampleDetailPage.tsx`, `dashboard/src/pages/ClientsPage.tsx`, `dashboard/src/pages/ChaserPage.tsx`, `dashboard/src/widget.ts`
- Modify: `dashboard/src/App.tsx` (routes), `dashboard/src/main.tsx` (init widget)

**Interfaces:**
- Consumes: `api`, types, `GET/PATCH /samples/:id`, `GET /tracking/:awb`, `GET/POST /clients`, `GET /chaser/digest`, `POST /chaser/run`.
- Produces: full read+write CRM per spec §7.

- [ ] **Step 1: `dashboard/src/pages/SampleDetailPage.tsx`**:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import type { Sample, SampleEvent } from '../types';
import StatusBadge from '../components/StatusBadge';

type Detail = Sample & { events: SampleEvent[] };

export default function SampleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Detail | null>(null);
  const [tracking, setTracking] = useState<{ status: string; eta: string | null; note: string } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<Detail>(`/samples/${id}`).then((d) => {
      setS(d);
      if (d.awb) api<{ status: string; eta: string | null; note: string }>(`/tracking/${d.awb}`).then(setTracking).catch(() => {});
    }).catch(console.error);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!s) return <p className="muted">loading…</p>;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form)) if (v !== '') body[k] = k === 'qty_grams' ? Number(v) : v;
    await api(`/samples/${s.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    setForm({});
    setSaving(false);
    load();
  };

  return (
    <>
      <h2>{s.ref ?? s.ref_raw ?? 'sample'} <StatusBadge status={s.status} /></h2>
      <div className="card">
        <p><b>{s.quality}</b> · {s.sample_type} · {s.qty_grams ? `${s.qty_grams}g` : s.qty_raw ?? '?'} → {s.receiver}
          {s.requester ? <span className="muted"> (asked by {s.requester})</span> : null}</p>
        <p className="muted">requested {s.requested_at?.slice(0, 10) ?? '—'} · dispatched {s.dispatched_at?.slice(0, 10) ?? '—'} · delivered {s.delivered_at?.slice(0, 10) ?? '—'}</p>
        {s.awb && <p>AWB <b>{s.awb}</b> ({s.courier}) {tracking && <> — {tracking.status}{tracking.eta ? `, ETA ${tracking.eta.slice(0, 10)}` : ''} <span className="muted">({tracking.note})</span></>}</p>}
        {s.result && <p>Result: <b>{s.result}</b> {s.cupping_notes && <span className="muted">— {s.cupping_notes}</span>}</p>}
      </div>

      <div className="card">
        <h3>Edit</h3>
        <form className="grid" onSubmit={save}>
          <label>status
            <select value={form.status ?? ''} onChange={set('status')}>
              <option value="">(keep)</option>
              {['requested', 'preparing', 'dispatched', 'delivered', 'results_in', 'cancelled'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label>courier
            <select value={form.courier ?? ''} onChange={set('courier')}>
              <option value="">(keep)</option>
              {['dhl', 'fedex', 'ups', 'rider', 'hand_delivery', 'client_pickup', 'other'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label>awb <input value={form.awb ?? ''} onChange={set('awb')} placeholder={s.awb ?? ''} /></label>
          <label>quality <input value={form.quality ?? ''} onChange={set('quality')} placeholder={s.quality ?? ''} /></label>
          <label>qty (g) <input type="number" value={form.qty_grams ?? ''} onChange={set('qty_grams')} placeholder={String(s.qty_grams ?? '')} /></label>
          <label>deadline <input type="date" value={form.deadline ?? ''} onChange={set('deadline')} /></label>
          <label>result
            <select value={form.result ?? ''} onChange={set('result')}>
              <option value="">(keep)</option>
              {['approved', 'rejected', 'pending_feedback'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label>cupping notes <textarea value={form.cupping_notes ?? ''} onChange={set('cupping_notes')} placeholder={s.cupping_notes ?? ''} /></label>
          <label>comments <textarea value={form.comments ?? ''} onChange={set('comments')} placeholder={s.comments ?? ''} /></label>
          <button className="primary" disabled={saving || Object.keys(form).length === 0}>Save changes</button>
        </form>
      </div>

      <div className="card">
        <h3>Timeline</h3>
        <ul className="timeline">
          {s.events.map((e) => (
            <li key={e.id}>
              <b>{e.type.replace('_', ' ')}</b> — {e.note} <span className="muted">({e.actor}, {e.created_at.slice(0, 16).replace('T', ' ')})</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
```

- [ ] **Step 2: `dashboard/src/pages/ClientsPage.tsx`**:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Client, ListResponse } from '../types';

export default function ClientsPage() {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Client[]>([]);
  const [selected, setSelected] = useState<Client | null>(null);
  const [form, setForm] = useState({ name: '', country: '', attention_to: '', full_address: '', phone: '', email: '' });

  const load = useCallback(() => {
    api<ListResponse<Client>>(`/clients?q=${encodeURIComponent(q)}`).then((r) => setList(r.data)).catch(console.error);
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const open = (id: string) => api<Client>(`/clients/${id}`).then(setSelected).catch(console.error);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const contact = form.attention_to || form.full_address || form.phone || form.email
      ? { attention_to: form.attention_to || null, full_address: form.full_address || null, phone: form.phone || null, email: form.email || null }
      : null;
    await api('/clients', { method: 'POST', body: JSON.stringify({ name: form.name, country: form.country || null, contact }) });
    setForm({ name: '', country: '', attention_to: '', full_address: '', phone: '', email: '' });
    load();
  };

  return (
    <>
      <h2>Clients</h2>
      <div className="filters">
        <input placeholder="Search clients…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Country</th><th>Contacts</th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => open(c.id)}>
                <td>{c.name}</td><td>{c.country ?? ''}</td><td>{c.contact_count ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="card">
          <h3>{selected.name} {selected.country ? <span className="muted">({selected.country})</span> : null}</h3>
          {selected.contacts?.length ? (
            <ul>
              {selected.contacts.map((ct) => (
                <li key={ct.id}><b>{ct.attention_to ?? '—'}</b> · {ct.full_address ?? ''} · {ct.phone ?? ''} {ct.email ? `· ${ct.email}` : ''}</li>
              ))}
            </ul>
          ) : <p className="muted">no contacts on file</p>}
        </div>
      )}
      <div className="card">
        <h3>Add client / contact</h3>
        <form className="grid" onSubmit={create}>
          <label>company name * <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>country <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></label>
          <label>contact person <input value={form.attention_to} onChange={(e) => setForm({ ...form, attention_to: e.target.value })} /></label>
          <label>address <input value={form.full_address} onChange={(e) => setForm({ ...form, full_address: e.target.value })} /></label>
          <label>phone <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>email <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <button className="primary">Save</button>
        </form>
      </div>
    </>
  );
}
```

- [ ] **Step 3: `dashboard/src/pages/ChaserPage.tsx`**:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Digest, DigestBucket } from '../types';

const TITLES: Record<string, string> = {
  not_dispatched: '⏰ Not yet dispatched (past due)',
  no_delivery_confirmation: '🚚 Dispatched, no delivery confirmation (>5 days)',
  awaiting_results: '📋 Delivered, awaiting results (>7 days)',
};

function Bucket({ name, b }: { name: string; b: DigestBucket }) {
  return (
    <div className="card">
      <h3>{TITLES[name]} — {b.count}</h3>
      <table>
        <thead><tr><th>Ref</th><th>Type</th><th>Quality</th><th>Receiver</th><th>Deadline</th><th>AWB</th></tr></thead>
        <tbody>
          {b.items.map((i) => (
            <tr key={String(i.id)}>
              <td><Link to={`/samples/${i.id}`}>{(i.ref ?? i.ref_raw ?? '—') as string}</Link></td>
              <td>{i.sample_type as string}</td>
              <td>{i.quality as string}</td>
              <td>{i.receiver as string}</td>
              <td>{(i.deadline as string | null)?.slice(0, 10) ?? ''}</td>
              <td>{(i.awb as string | null) ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {b.count > b.items.length && <p className="muted">showing {b.items.length} of {b.count}</p>}
    </div>
  );
}

export default function ChaserPage() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    api<Digest>('/chaser/digest').then(setDigest).catch(() => setDigest(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async () => {
    setRunning(true);
    await api('/chaser/run', { method: 'POST' });
    setRunning(false);
    load();
  };

  return (
    <>
      <h2>Chaser digest <button className="primary" onClick={run} disabled={running}>{running ? 'running…' : 'Run now'}</button></h2>
      {digest ? (
        <>
          <p className="muted">generated {digest.generated_at.slice(0, 16).replace('T', ' ')}</p>
          {Object.entries(digest.buckets).map(([name, b]) => <Bucket key={name} name={name} b={b} />)}
        </>
      ) : <p className="muted">No digest yet — hit "Run now" or wait for the weekday-morning job.</p>}
    </>
  );
}
```

- [ ] **Step 4: Widget + routes.** `dashboard/src/widget.ts`:

```ts
declare global {
  interface Window { LuaPop?: { init(cfg: { agentId: string; position: string }): void } }
}

export function initLuaWidget() {
  const s = document.createElement('script');
  s.src = 'https://lua-ai-global.github.io/lua-pop/lua-pop.umd.js';
  s.onload = () => window.LuaPop?.init({
    agentId: import.meta.env.VITE_LUA_AGENT_ID,
    position: 'bottom-right',
  });
  document.body.appendChild(s);
}
```

In `dashboard/src/main.tsx` add:

```tsx
import { initLuaWidget } from './widget';
initLuaWidget();
```

Update `dashboard/src/App.tsx` routes:

```tsx
import SampleDetailPage from './pages/SampleDetailPage';
import ClientsPage from './pages/ClientsPage';
import ChaserPage from './pages/ChaserPage';
// inside <Routes>:
<Route path="/" element={<SamplesPage />} />
<Route path="/samples/:id" element={<SampleDetailPage />} />
<Route path="/clients" element={<ClientsPage />} />
<Route path="/chaser" element={<ChaserPage />} />
```

- [ ] **Step 5: Verify**

Run: `cd dashboard && npm run build`
Expected: build succeeds.
Manual: open a sample → detail + timeline render; edit status → timeline gains an `edited`/`status_change` row with actor `dashboard`; Clients search + add works; Chaser "Run now" renders three buckets; the chat bubble appears bottom-right (it will only answer usefully once Task 14's tunnel is up and the agent is pushed).

- [ ] **Step 6: Commit**

```bash
git add dashboard
git commit -m "feat(dashboard): detail/edit, clients, chaser pages + lua widget"
```

---

### Task 14: End-to-end wiring — tunnel, push, scripted demo pass

**Files:**
- Create: `DEMO.md` (runbook at repo root)

**Interfaces:**
- Consumes: everything above.
- Produces: verified end-to-end flow matching spec §11; runbook for the go/no-go demo.

- [ ] **Step 1: Write `DEMO.md`**:

```markdown
# Demo runbook

## Boot order
1. `docker compose up -d postgres`
2. `cd api && npm run migrate && npm run dev`        # :4000
3. `cd scripts && npm run seed`                      # ~2,300 samples, ~270 clients
4. Tunnel: `cloudflared tunnel --url http://localhost:4000`  # note the https URL
   (alternative: `ngrok http 4000`)
5. Set agent env (server-side): `npx lua env set API_BASE_URL=<tunnel-url>` and
   `npx lua env set API_KEY=dev-key-sucafina`  — if `lua env` syntax differs, check `npx lua env --help`.
6. Push agent: `npx lua push` (do NOT deploy from CLI; use /lua-deploy when promoting)
7. `cd dashboard && npm run dev`                     # :5173

## Script (go/no-go session)
1. Dashboard Samples page — "this is your Sample Chaser, alive" (tiles show the real backlog)
2. Widget, as trader: "Can you send AB FAQ and Heavy Mbuni type samples to Thomas at Beyers? Needed by Friday."
   → expect: client resolved, 2 records created, refs echoed; table refresh shows them
3. Widget, as QC: "Beyers samples went out today, DHL 9620551651"
   → expect: both flip to dispatched with AWB; timeline shows actor agent:chat
4. Widget: "where are the Beyers samples now?" → tracking stub status + ETA
5. Chaser page → Run now → real gaps in their real data (PSS first)
6. Widget: "SSKE PSS for Nestrade cupped 83, citrus driven, clean — approved"
   → expect: result recorded, status results_in
7. Close on the tiles: management visibility

## Troubleshooting
- Widget can't act / tool errors mention API: tunnel died — restart step 4 and update API_BASE_URL.
- 401s: API_KEY mismatch between api/.env and lua env.
- Empty dashboard: seed didn't run or DATABASE_URL points at the wrong port (5433).
```

- [ ] **Step 2: Execute the boot order end-to-end** (all of it, including tunnel + `npx lua push`).

- [ ] **Step 3: Run the 6 scripted conversations** through `npx lua chat` (or the widget) and check each expectation in DEMO.md. Record any persona misbehavior (too verbose, asks >1 question, invents data) and fix `src/persona.ts` / skill `context` strings, `npx lua push`, retest.

- [ ] **Step 4: Trigger the chaser once**: `curl -X POST -H 'x-api-key: dev-key-sucafina' http://localhost:4000/chaser/run | head -c 400` then confirm the Chaser page shows the digest. Optionally test the LuaJob itself from the Lua dashboard/sandbox (`npx lua jobs` to inspect).

- [ ] **Step 5: Commit**

```bash
git add DEMO.md
git commit -m "docs: demo runbook; end-to-end verified"
```

---

## Self-review notes (already applied)

- Spec §4 lacked `moisture`/`water_activity` columns that §8 seeds — added to the migration (Task 2) and flagged; update the spec doc when convenient.
- `get_next_ref` tool from the spec was folded into server-side ref issuance (`POST /samples`) per the spec's own API section; `GetSampleStatusTool` retained.
- Type consistency: list endpoints uniformly return `{ data, total }`; sample PATCH auto-derives `results_in`; tool names match spec §6 (`find_client`, `create_sample_request`, `find_open_samples`, `record_dispatch`, `search_samples`, `get_sample_status`, `track_awb`, `record_result`, `list_awaiting_results`, `upsert_client`).
- Known risk, called out in Tasks 11/14: whether `lua test` executes tools locally or in the cloud sandbox decides when behavior testing becomes possible (compile-only until the tunnel is up). The plan works either way.
```
