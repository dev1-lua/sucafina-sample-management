# Phase 1: Three-Table DB + Seed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three dedicated sample tables (one per workbook sheet), a polymorphic event log, a traders table + account-owner FK, soft-delete columns, and a cross-table read view; then seed all four sheets into them with zero dropped rows — leaving the legacy `samples` table untouched.

**Architecture:** A new SQL migration (`002_three_tables.sql`) creates the new objects alongside the existing `001_init.sql` schema. The migration runner is upgraded to apply all migration files in order. The existing tolerant, tested seed parsers are reused; the seed runner is extended with three new per-table loaders (each writing verbatim source columns + typed companions + a `created` event), a traders seed, and a per-table count/dropped report. The legacy `samples` loader stays exactly as-is.

**Tech Stack:** PostgreSQL 16 (Docker, host port 5433), TypeScript ESM run via `tsx`, `pg`, `xlsx`, `vitest`.

## Global Constraints

- **Single writer / audit trail:** every new-table row insert also appends a row to the polymorphic `events` table, actor-stamped (`'seed'` for the seed). (Copied from spec §1, §4.4.)
- **Legacy untouched:** do not alter `samples`, `sample_events`, `ref_counters`, `chaser_digests`, or `001_init.sql`. The legacy `samples` seed loop stays byte-for-byte as-is. (spec §9)
- **Verbatim + companions:** each sample table stores its sheet's columns verbatim (mostly `text`), plus typed companion columns (`date_on`, `qty_grams`, `courier_norm`, etc.) used only for sort/filter. All source columns are **nullable**. (spec §4)
- **Forwarding:** one row per `ID Number` (= one row per source data row); `id_number` is nullable and **not unique**; reduced lifecycle (`requested → dispatched → delivered`, never `results_in`). (spec §3 #1, §4.3)
- **Naming:** snake_case, plural tables. (spec §4)
- **Row-count acceptance:** `specialty_samples` = **1063**, `bulk_samples` = **1237**, `forwarding_samples` = **15**, `clients` = **270**, `traders` = **9**, `legacy_samples` = **2300**, **0 dropped rows**. (spec §2, §8, §11)
- **DB connection:** `DATABASE_URL` defaults to `postgres://sucafina:sucafina@localhost:5433/sucafina`. Container name `sucafina-postgres`.

---

## File Structure

- `api/scripts/migrate.ts` (modify) — apply **all** `NNN_*.sql` migrations in sorted order (excluding `000_create_test_db.sql`), instead of only `001_init.sql`.
- `api/migrations/002_three_tables.sql` (create) — all new DDL: enums, `traders`, `clients` alterations, the three sample tables + indexes, `events`, and the `all_samples_v` view.
- `scripts/seed/parsers.ts` (modify) — add one pure parser, `parseNumeric`, for the moisture / water-activity companions.
- `scripts/seed/parsers.test.ts` (modify) — add unit tests for `parseNumeric`.
- `scripts/seed/run.ts` (modify) — extend `TRUNCATE`; seed `traders`; add three per-table loaders (verbatim columns + companions + `created` events); extend `seed-report.json` with per-table counts + `dropped`. Legacy loops unchanged.
- `scripts/seed-report.json` (regenerated output — not hand-edited).

---

## Task 1: Migration runner applies all migrations in order

**Files:**
- Modify: `api/scripts/migrate.ts` (whole file)

**Interfaces:**
- Consumes: `DATABASE_URL` env (default `postgres://sucafina:sucafina@localhost:5433/sucafina`); migration files in `api/migrations/`.
- Produces: `npm run migrate` and `npm run db:reset` (from `api/`) apply every `NNN_*.sql` file except `000_create_test_db.sql`, in ascending filename order.

- [ ] **Step 1: Ensure Postgres is up and deps installed**

Run:
```bash
cd /Users/devashishthapliyal/Documents/work/Lua/Sucafina
docker compose up -d postgres
cd api && npm install
```
Expected: container `sucafina-postgres` running (`docker ps` shows it); `npm install` completes.

- [ ] **Step 2: Replace `api/scripts/migrate.ts` with the multi-file runner**

```typescript
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://sucafina:sucafina@localhost:5433/sucafina';
const client = new pg.Client({ connectionString: url });
await client.connect();

if (process.argv.includes('--reset')) {
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('schema dropped');
}

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));
const files = readdirSync(migrationsDir)
  .filter((f) => /^\d+.*\.sql$/.test(f) && f !== '000_create_test_db.sql')
  .sort();

for (const f of files) {
  const sql = readFileSync(path.join(migrationsDir, f), 'utf8');
  await client.query(sql);
  console.log(`applied ${f}`);
}
console.log(`migrated ${url}`);
await client.end();
```

- [ ] **Step 3: Run a reset+migrate with only `001` present and verify it still applies**

Run:
```bash
cd /Users/devashishthapliyal/Documents/work/Lua/Sucafina/api && npm run db:reset
```
Expected output includes:
```
schema dropped
applied 001_init.sql
migrated postgres://sucafina:sucafina@localhost:5433/sucafina
```

- [ ] **Step 4: Confirm the legacy schema exists**

Run:
```bash
docker exec sucafina-postgres psql -U sucafina -d sucafina -c "\dt"
```
Expected: lists `samples`, `sample_events`, `clients`, `client_contacts`, `ref_counters`, `chaser_digests`.

- [ ] **Step 5: Commit**

```bash
cd /Users/devashishthapliyal/Documents/work/Lua/Sucafina
git add api/scripts/migrate.ts
git commit -m "chore(api): migrate runner applies all migrations in sorted order"
```

---

## Task 2: Migration `002_three_tables.sql` — new schema

**Files:**
- Create: `api/migrations/002_three_tables.sql`

**Interfaces:**
- Consumes: enums/tables from `001_init.sql` (`courier_t`, `result_t`, `sample_type_t`, `sample_status_t`, `clients`).
- Produces (relied on by Task 4 and later phases):
  - Tables `specialty_samples`, `bulk_samples`, `forwarding_samples` with the exact columns below.
  - Table `events (id, entity_type, entity_id, type, note, actor, created_at)`.
  - Table `traders (id, name UNIQUE, email, role, active, created_at)`.
  - `clients.account_owner_id uuid → traders(id)`, `clients.deleted_at timestamptz`.
  - View `all_samples_v (tab, id, ref, title, receiver, country, client_id, status, courier_norm, awb, qty_grams, date_on, delivery_on, result_norm, created_at, deleted_at)`.
  - Enums `entity_type_scope`, `entity_event_t`.

- [ ] **Step 1: Create `api/migrations/002_three_tables.sql`**

```sql
-- 002_three_tables.sql
-- Three dedicated sample tables (one per workbook sheet), a polymorphic event
-- log, traders + clients.account_owner_id, soft-delete columns, and a
-- cross-table read view. Legacy samples/sample_events (001) are left untouched.

-- ---- enums ------------------------------------------------------------
CREATE TYPE entity_type_scope AS ENUM ('specialty','bulk','forwarding','client');
CREATE TYPE entity_event_t AS ENUM
  ('created','edited','status_change','dispatched','delivery_update',
   'result_logged','chased','note','deleted','restored');

-- ---- traders + clients additions -------------------------------------
CREATE TABLE traders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  email text,
  role text NOT NULL DEFAULT 'trader' CHECK (role IN ('trader','qc')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE clients ADD COLUMN account_owner_id uuid REFERENCES traders(id);
ALTER TABLE clients ADD COLUMN deleted_at timestamptz;

-- ---- specialty_samples (Sample tab) ----------------------------------
CREATE TABLE specialty_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- source columns (verbatim, display order)
  date text, ref text, outturn text, name text, grade text, bags integer,
  description text, receiver_company text, awb text, courier text, qty text,
  delivery_date text, result text, comments text, crop_year text, crop_area_details text,
  -- typed companions (sort/filter only)
  date_on date, delivery_on date, qty_grams integer,
  courier_norm courier_t, result_norm result_t, sample_type_norm sample_type_t,
  -- system
  client_id uuid REFERENCES clients(id),
  status sample_status_t NOT NULL DEFAULT 'requested',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX specialty_status_idx ON specialty_samples (status);
CREATE INDEX specialty_client_idx ON specialty_samples (client_id);
CREATE INDEX specialty_date_idx   ON specialty_samples (date_on);
CREATE INDEX specialty_awb_idx    ON specialty_samples (awb);

-- ---- bulk_samples (Bulk tab) -----------------------------------------
CREATE TABLE bulk_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- source columns (verbatim, display order)
  date text, sample_ref text, bags integer, quality text, client_ref text,
  ico_mark text, sample_type text, client text, country text, awb text,
  courier text, qty text, moisture text, water_activity text, delivery_date text,
  result text, comments text, crop_year text, crop_area_details text,
  -- typed companions (sort/filter only)
  date_on date, delivery_on date, qty_grams integer,
  courier_norm courier_t, result_norm result_t, sample_type_norm sample_type_t,
  moisture_pct numeric, water_activity_num numeric,
  -- system
  client_id uuid REFERENCES clients(id),
  status sample_status_t NOT NULL DEFAULT 'requested',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bulk_status_idx ON bulk_samples (status);
CREATE INDEX bulk_client_idx ON bulk_samples (client_id);
CREATE INDEX bulk_date_idx   ON bulk_samples (date_on);
CREATE INDEX bulk_awb_idx    ON bulk_samples (awb);

-- ---- forwarding_samples (Forwarding tab) -----------------------------
CREATE TABLE forwarding_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- source columns (verbatim, display order) — one row per ID Number
  date text, sender text, origin text, sample_ref text, coffee_quality text,
  receiver_company text, id_number text, awb text, courier text, qty text,
  -- typed companions (sort/filter only)
  date_on date, qty_grams integer, courier_norm courier_t,
  -- system (reduced lifecycle: never results_in)
  client_id uuid REFERENCES clients(id),
  status sample_status_t NOT NULL DEFAULT 'requested',
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forwarding_status_idx ON forwarding_samples (status);
CREATE INDEX forwarding_client_idx ON forwarding_samples (client_id);
CREATE INDEX forwarding_date_idx   ON forwarding_samples (date_on);
CREATE INDEX forwarding_awb_idx    ON forwarding_samples (awb);

-- ---- polymorphic event log (legacy sample_events untouched) ----------
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type entity_type_scope NOT NULL,
  entity_id uuid NOT NULL,
  type entity_event_t NOT NULL,
  note text,
  actor text NOT NULL DEFAULT 'api',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_entity_idx ON events (entity_type, entity_id, created_at);

-- ---- cross-table read view -------------------------------------------
CREATE VIEW all_samples_v AS
  SELECT 'specialty'::text AS tab, id, ref AS ref, description AS title,
         receiver_company AS receiver, NULL::text AS country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at
    FROM specialty_samples
  UNION ALL
  SELECT 'bulk', id, sample_ref, quality, client, country, client_id, status,
         courier_norm, awb, qty_grams, date_on, delivery_on, result_norm,
         created_at, deleted_at
    FROM bulk_samples
  UNION ALL
  SELECT 'forwarding', id, sample_ref, coffee_quality, receiver_company, origin,
         client_id, status, courier_norm, awb, qty_grams, date_on,
         NULL::date, NULL::result_t, created_at, deleted_at
    FROM forwarding_samples;
```

- [ ] **Step 2: Apply the migration from a clean schema**

Run:
```bash
cd /Users/devashishthapliyal/Documents/work/Lua/Sucafina/api && npm run db:reset
```
Expected output includes:
```
schema dropped
applied 001_init.sql
applied 002_three_tables.sql
migrated postgres://sucafina:sucafina@localhost:5433/sucafina
```

- [ ] **Step 3: Verify the new tables and view exist**

Run:
```bash
docker exec sucafina-postgres psql -U sucafina -d sucafina -c "\dt" -c "\dv"
```
Expected: `\dt` lists `specialty_samples`, `bulk_samples`, `forwarding_samples`, `traders`, `events` (plus the legacy tables); `\dv` lists `all_samples_v`.

- [ ] **Step 4: Verify the specialty column set (16 source + 6 companion + system)**

Run:
```bash
docker exec sucafina-postgres psql -U sucafina -d sucafina -c "\d specialty_samples"
```
Expected: columns `date, ref, outturn, name, grade, bags, description, receiver_company, awb, courier, qty, delivery_date, result, comments, crop_year, crop_area_details` then `date_on, delivery_on, qty_grams, courier_norm, result_norm, sample_type_norm` then `client_id, status, deleted_at, created_at, updated_at`.

- [ ] **Step 5: Verify the view selects (empty but valid)**

Run:
```bash
docker exec sucafina-postgres psql -U sucafina -d sucafina -c "SELECT count(*) FROM all_samples_v;"
```
Expected: `0` (no rows yet, but the view compiles and unions cleanly).

- [ ] **Step 6: Commit**

```bash
cd /Users/devashishthapliyal/Documents/work/Lua/Sucafina
git add api/migrations/002_three_tables.sql
git commit -m "feat(api): migration 002 — three sample tables, events, traders, view"
```

---

## Task 3: `parseNumeric` parser for moisture / water-activity companions

**Files:**
- Modify: `scripts/seed/parsers.ts` (append one function)
- Test: `scripts/seed/parsers.test.ts` (append one describe block)

**Interfaces:**
- Produces: `parseNumeric(raw: unknown): number | null` — returns a finite number only for clean numeric input (integer/decimal, optional trailing `%`); `null` for coded/dirty cells like `"PD,61"`, `"SD172"`, empty, or `null`.

- [ ] **Step 1: Write the failing test — append to `scripts/seed/parsers.test.ts`**

```typescript
import { parseNumeric } from './parsers.js';

describe('parseNumeric', () => {
  it.each([
    ['12', 12], ['0.43', 0.43], ['300', 300], ['10.5%', 10.5], ['  7 ', 7], [12, 12],
  ])('%s -> %s', (raw, expected) => expect(parseNumeric(raw)).toBe(expected));
  it.each([
    ['PD,61', null], ['SD172', null], ['SD,213', null], ['', null], ['abc', null],
    [null, null], [NaN, null], [Infinity, null],
  ])('%s -> null', (raw) => expect(parseNumeric(raw as unknown)).toBeNull());
});
```

Note: add `parseNumeric` to the existing top-of-file import from `./parsers.js` (the file already imports `parseQtyGrams, normalizeCourier, ...`). The standalone `import { parseNumeric }` line above is acceptable too — either compiles.

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/devashishthapliyal/Documents/work/Lua/Sucafina/scripts && npx vitest run seed/parsers.test.ts -t parseNumeric
```
Expected: FAIL — `parseNumeric is not a function` / export missing.

- [ ] **Step 3: Implement — append to `scripts/seed/parsers.ts`**

```typescript
export function parseNumeric(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*%?$/);
  return m ? parseFloat(m[1]) : null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd /Users/devashishthapliyal/Documents/work/Lua/Sucafina/scripts && npx vitest run seed/parsers.test.ts -t parseNumeric
```
Expected: PASS (all `parseNumeric` cases green).

- [ ] **Step 5: Run the full parser suite (no regressions)**

Run:
```bash
cd /Users/devashishthapliyal/Documents/work/Lua/Sucafina/scripts && npm run test
```
Expected: all tests pass (existing ~60 + the new `parseNumeric` cases).

- [ ] **Step 6: Commit**

```bash
cd /Users/devashishthapliyal/Documents/work/Lua/Sucafina
git add scripts/seed/parsers.ts scripts/seed/parsers.test.ts
git commit -m "feat(seed): parseNumeric for moisture/water-activity companions"
```

---

## Task 4: Seed traders + the three tables + events; extend the report

**Files:**
- Modify: `scripts/seed/run.ts`
- Regenerated: `scripts/seed-report.json`

**Interfaces:**
- Consumes: `parseQtyGrams`, `normalizeCourier`, `classifySampleType`, `parseSheetDate`, `parseResult`, `parseNumeric` (Task 3), `resolveClient` (existing in `run.ts`), the three tables + `events` + `traders` (Task 2).
- Produces: populated `specialty_samples` (1063), `bulk_samples` (1237), `forwarding_samples` (15), `traders` (9), `events` (2315 `created` rows), and a `seed-report.json` with per-table counts, `expected`, and `dropped`.

Column index reference (0-based, `header:1`):
- **Specialty:** `0 date, 1 ref, 2 outturn, 3 name, 4 grade, 5 bags, 6 description, 7 receiver_company, 8 awb, 9 courier, 10 qty, 11 delivery_date, 12 result, 13 comments, 14 crop_year, 15 crop_area_details`.
- **Bulk:** `0 date, 1 sample_ref, 2 bags, 3 quality, 4 client_ref, 5 ico_mark, 6 sample_type, 7 client, 8 country, 9 awb, 10 courier, 11 qty, 12 moisture, 13 water_activity, 14 delivery_date, 15 result, 16 comments, 17 crop_year, 18 crop_area_details`.
- **Forwarding:** `0 date, 1 sender, 2 origin, 3 sample_ref, 4 coffee_quality, 5 receiver_company, 6 id_number, 7 awb, 8 courier, 9 qty`.

- [ ] **Step 1: Extend the `TRUNCATE` to include the new tables**

In `scripts/seed/run.ts`, replace the existing truncate line:
```typescript
  await client.query(`TRUNCATE sample_events, samples, client_contacts, clients RESTART IDENTITY CASCADE`);
```
with:
```typescript
  await client.query(`TRUNCATE events, forwarding_samples, bulk_samples, specialty_samples,
    sample_events, samples, client_contacts, clients, traders RESTART IDENTITY CASCADE`);
```

- [ ] **Step 2: Seed the traders (insert right after the clients loop, before the `resolveClient` function)**

Insert this block immediately after the `for (const r of clientRows) { ... }` loop closes:
```typescript
// ---- 1b. traders (from the persona's known team; clients left unassigned) --
const TRADERS: ReadonlyArray<readonly [string, 'trader' | 'qc']> = [
  ['Ivo', 'trader'], ['Omar', 'trader'], ['Muki', 'trader'], ['Brian', 'trader'], ['Gloria', 'trader'],
  ['Bernard', 'qc'], ['Brillian', 'qc'], ['Harriet', 'qc'], ['Anička', 'qc'],
];
for (const [name, role] of TRADERS) {
  await client.query(
    `INSERT INTO traders (name, role) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
    [name, role]);
}
```

- [ ] **Step 3: Add a date-formatting helper and per-table counters (near the top, after the `str` helper)**

```typescript
const fmtDate = (v: unknown): string | null => {
  const d = parseSheetDate(v);
  return d ? d.toISOString().slice(0, 10) : str(v);
};
let specialtyLoaded = 0, bulkLoaded = 0, forwardingLoaded = 0;
```

Add `parseNumeric` to the import from `./parsers.js` at the top of the file:
```typescript
import {
  parseQtyGrams, normalizeCourier, classifySampleType, parseSheetDate, normalizeName, parseResult, parseNumeric,
} from './parsers.js';
```

- [ ] **Step 4: Add the three loader functions (place after the existing `insertSample` / `inferStatus` functions)**

```typescript
async function insertSpecialtySample(r: Row) {
  const d0 = parseSheetDate(r[0]); const dd = parseSheetDate(r[11]);
  const result = parseResult(r[12]); const awb = str(r[8]);
  const courierNorm = normalizeCourier(r[9]);
  const st = classifySampleType(r[6]);
  const status = inferStatus(result, dd, awb, courierNorm);
  const { rows } = await client.query(
    `INSERT INTO specialty_samples
       (date, ref, outturn, name, grade, bags, description, receiver_company, awb, courier, qty,
        delivery_date, result, comments, crop_year, crop_area_details,
        date_on, delivery_on, qty_grams, courier_norm, result_norm, sample_type_norm, client_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING id`,
    [fmtDate(r[0]), str(r[1]), str(r[2]), str(r[3]), str(r[4]),
     typeof r[5] === 'number' ? Math.round(r[5]) : null, str(r[6]), str(r[7]), awb, str(r[9]), str(r[10]),
     fmtDate(r[11]), str(r[12]), str(r[13]), str(r[14]), str(r[15]),
     d0, dd, parseQtyGrams(r[10]), courierNorm, result, st.type, resolveClient(str(r[7])), status]);
  await client.query(
    `INSERT INTO events (entity_type, entity_id, type, note, actor, created_at)
     VALUES ('specialty',$1,'created','imported from Sample Chaser','seed',$2)`,
    [rows[0].id, d0 ?? new Date()]);
  specialtyLoaded++;
}

async function insertBulkSample(r: Row) {
  const d0 = parseSheetDate(r[0]); const dd = parseSheetDate(r[14]);
  const result = parseResult(r[15]); const awb = str(r[9]);
  const courierNorm = normalizeCourier(r[10]);
  const st = classifySampleType(r[6]);
  const status = inferStatus(result, dd, awb, courierNorm);
  const { rows } = await client.query(
    `INSERT INTO bulk_samples
       (date, sample_ref, bags, quality, client_ref, ico_mark, sample_type, client, country, awb,
        courier, qty, moisture, water_activity, delivery_date, result, comments, crop_year, crop_area_details,
        date_on, delivery_on, qty_grams, courier_norm, result_norm, sample_type_norm,
        moisture_pct, water_activity_num, client_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
     RETURNING id`,
    [fmtDate(r[0]), str(r[1]), typeof r[2] === 'number' ? Math.round(r[2]) : null, str(r[3]), str(r[4]),
     str(r[5]), str(r[6]), str(r[7]), str(r[8]), awb, str(r[10]), str(r[11]),
     str(r[12]), str(r[13]), fmtDate(r[14]), str(r[15]), str(r[16]), str(r[17]), str(r[18]),
     d0, dd, parseQtyGrams(r[11]), courierNorm, result, st.type,
     parseNumeric(r[12]), parseNumeric(r[13]), resolveClient(str(r[7])), status]);
  await client.query(
    `INSERT INTO events (entity_type, entity_id, type, note, actor, created_at)
     VALUES ('bulk',$1,'created','imported from Sample Chaser','seed',$2)`,
    [rows[0].id, d0 ?? new Date()]);
  bulkLoaded++;
}

async function insertForwardingSample(r: Row) {
  const d0 = parseSheetDate(r[0]); const awb = str(r[7]);
  const courierNorm = normalizeCourier(r[8]);
  const status = awb || courierNorm ? 'dispatched' : 'requested';
  const { rows } = await client.query(
    `INSERT INTO forwarding_samples
       (date, sender, origin, sample_ref, coffee_quality, receiver_company, id_number, awb, courier, qty,
        date_on, qty_grams, courier_norm, client_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id`,
    [fmtDate(r[0]), str(r[1]), str(r[2]), str(r[3]), str(r[4]), str(r[5]), str(r[6]), awb, str(r[8]), str(r[9]),
     d0, parseQtyGrams(r[9]), courierNorm, resolveClient(str(r[5])), status]);
  await client.query(
    `INSERT INTO events (entity_type, entity_id, type, note, actor, created_at)
     VALUES ('forwarding',$1,'created','imported from E A Forwarding','seed',$2)`,
    [rows[0].id, d0 ?? new Date()]);
  forwardingLoaded++;
}
```

- [ ] **Step 5: Add the three load loops (place right before the `// ---- 3. ref counters` section)**

The `spec` and `bulk` row arrays are already declared earlier in the file (the legacy loops use them); reuse them and add the forwarding sheet:
```typescript
// ---- 2b. new dedicated tables (legacy `samples` load above is unchanged) ----
for (let i = 1; i < spec.length; i++) {
  const r = spec[i];
  if (!r || !r.some((v) => str(v))) continue;
  await insertSpecialtySample(r);
}
for (let i = 1; i < bulk.length; i++) {
  const r = bulk[i];
  if (!r || !r.some((v) => str(v))) continue;
  await insertBulkSample(r);
}
const fwd = rowsOf('E A Forwarding 2024-2025');
for (let i = 1; i < fwd.length; i++) {
  const r = fwd[i];
  if (!r || !r.some((v) => str(v))) continue;
  await insertForwardingSample(r);
}
```

- [ ] **Step 6: Extend the report (replace the `// ---- 4. report` block)**

Replace the existing counts query + report block with:
```typescript
// ---- 4. report --------------------------------------------------------
const nonEmpty = (name: string): number =>
  rowsOf(name).slice(1).filter((r) => r && r.some((v) => str(v))).length;
const counts = await client.query(`
  SELECT (SELECT count(*)::int FROM clients) AS clients,
         (SELECT count(*)::int FROM client_contacts) AS contacts,
         (SELECT count(*)::int FROM traders) AS traders,
         (SELECT count(*)::int FROM samples) AS legacy_samples,
         (SELECT count(*)::int FROM specialty_samples) AS specialty_samples,
         (SELECT count(*)::int FROM bulk_samples) AS bulk_samples,
         (SELECT count(*)::int FROM forwarding_samples) AS forwarding_samples,
         (SELECT count(*)::int FROM events) AS events`);
const c = counts.rows[0];
const expected = {
  specialty_samples: nonEmpty('Specialty Samples 2024-2025'),
  bulk_samples: nonEmpty('BulkSamples 2024-2025'),
  forwarding_samples: nonEmpty('E A Forwarding 2024-2025'),
};
const dropped = {
  specialty_samples: expected.specialty_samples - c.specialty_samples,
  bulk_samples: expected.bulk_samples - c.bulk_samples,
  forwarding_samples: expected.forwarding_samples - c.forwarding_samples,
};
const report = { ...c, expected, dropped, warnings: warnings.length, details: warnings };
writeFileSync(path.resolve(__dirname, '../seed-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, details: undefined }, null, 2));
await client.end();
```

- [ ] **Step 7: Run the seed**

Run:
```bash
cd /Users/devashishthapliyal/Documents/work/Lua/Sucafina/scripts && npm install && npm run seed
```
Expected console JSON (order may vary):
```
{
  "clients": 270,
  "contacts": 290,
  "traders": 9,
  "legacy_samples": 2300,
  "specialty_samples": 1063,
  "bulk_samples": 1237,
  "forwarding_samples": 15,
  "events": 2315,
  "expected": { "specialty_samples": 1063, "bulk_samples": 1237, "forwarding_samples": 15 },
  "dropped": { "specialty_samples": 0, "bulk_samples": 0, "forwarding_samples": 0 },
  "warnings": 0
}
```

- [ ] **Step 8: Verify the acceptance numbers against the DB (independent of the report)**

Run:
```bash
docker exec sucafina-postgres psql -U sucafina -d sucafina -c \
"SELECT (SELECT count(*) FROM specialty_samples) spec, (SELECT count(*) FROM bulk_samples) bulk, (SELECT count(*) FROM forwarding_samples) fwd, (SELECT count(*) FROM all_samples_v) view_total, (SELECT count(*) FROM events) events, (SELECT count(*) FROM samples) legacy;"
```
Expected: `spec=1063, bulk=1237, fwd=15, view_total=2315, events=2315, legacy=2300`.

- [ ] **Step 9: Verify Forwarding fidelity (one row per ID number, dup IDs kept, null-id rows kept)**

Run:
```bash
docker exec sucafina-postgres psql -U sucafina -d sucafina -c \
"SELECT count(*) total, count(id_number) with_id, count(distinct awb) awbs FROM forwarding_samples;"
```
Expected: `total=15, with_id=13, awbs=4` (two rows have a null `id_number`; the duplicate `UGF/25/028` is preserved as two rows).

- [ ] **Step 10: Commit**

```bash
cd /Users/devashishthapliyal/Documents/work/Lua/Sucafina
git add scripts/seed/run.ts scripts/seed-report.json
git commit -m "feat(seed): load traders + specialty/bulk/forwarding tables with events"
```

---

## Self-Review (completed against the spec)

**1. Spec coverage:**
- spec §4.1–4.3 (three tables, verbatim + companions, nullable, reduced forwarding lifecycle) → Task 2.
- spec §4.4 (polymorphic `events`) → Task 2 + `created` events in Task 4.
- spec §4.5 (`traders`, `clients.account_owner_id`, `clients.deleted_at`) → Task 2 (schema) + Task 4 (seed traders, clients left unassigned).
- spec §4.6 (`all_samples_v`) → Task 2 + verified non-empty in Task 4 Step 8.
- spec §8 (extend seed, reuse parsers, one forwarding row per ID number, honest-sparse links via existing `resolveClient`, legacy `samples` unchanged, per-table counts + 0 dropped) → Tasks 3–4.
- spec §2/§11 acceptance counts (1063/1237/15/270, 0 dropped) → Task 4 Steps 7–9.
- spec §9 (migration `002` alongside `001`, runner applies all) → Tasks 1–2.

**2. Placeholder scan:** none — every step has concrete code/commands and expected output.

**3. Type consistency:** loader function names (`insertSpecialtySample`/`insertBulkSample`/`insertForwardingSample`), counters (`specialtyLoaded`/`bulkLoaded`/`forwardingLoaded`), `parseNumeric` signature, and the `events`/table column lists match between Task 2 (schema), Task 3 (parser), and Task 4 (seed). Enum values passed as plain strings into enum columns follow the existing working pattern in `insertSample`.

**Out of scope for Phase 1 (later phases):** API routes/helpers, dashboard, agent tools, `/stats`+`/search`+`/chaser` repointing — these are Phases 2–5 in spec §9.
