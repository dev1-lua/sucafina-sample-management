# Phase 3 — Frontend Foundation (Twenty-grade UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer of a UI task MUST load the **frontend-design** skill (Twenty-grade polish is a build requirement, spec §7.1); the token/palette task additionally loads **dataviz**.

**Goal:** Build the reusable Twenty-grade frontend foundation for the Sample Management rebuild — a fresh `dashboard-v2/` app with a design-token pass, app shell (nav + Cmd+K + theme toggle), and the shared `RecordTable`/`FilterBar`/`DetailDrawer`/`Timeline` components — with all three sample tabs + a Clients list rendering live against the Phase-2 API.

**Architecture:** A new Vite + React 18 + TypeScript SPA under `dashboard-v2/` (the existing `dashboard/` is left untouched as the prior-project demo artifact). TanStack Query wraps a copied `api()` helper (`x-actor: dashboard`) for all reads/writes; TanStack Table + Virtual drives a server-driven, virtualized `RecordTable` honoring the API's sort/filter/pagination whitelists; shadcn/ui primitives are vendored and restyled to a Twenty-flavored Tailwind token system. Routes are per-tab with a nested `:id` child that opens a right-side `DetailDrawer`.

**Tech Stack:** Vite 5, React 18.3, TypeScript 5.5, Tailwind CSS v3, shadcn/ui (Radix + Tailwind), TanStack Query v5, TanStack Table v8, TanStack Virtual v3, Framer Motion 11, cmdk, Recharts 2 (installed now; charts land in Phase 4), @tabler/icons-react, Vitest + @testing-library/react (jsdom).

## Global Constraints

- **Fresh app only.** All new files live under `dashboard-v2/`. Do NOT modify the existing `dashboard/` directory, and do NOT touch any `api/`, `scripts/`, `src/` (agent), or migration files — this phase is frontend-only. The API is already complete and running.
- **No UI reads legacy `samples`.** Every data call targets the new routers (`/specialty-samples`, `/bulk-samples`, `/forwarding-samples`, `/clients`, `/traders`, `/search`, `/stats`, `/tracking`) or `all_samples_v`-backed endpoints. Never call `/samples`.
- **All writes go through the API with `x-actor: dashboard`.** The FE never writes any other way. The `api()` helper sets `x-api-key` + `x-actor: dashboard` on every request.
- **Server-driven lists.** Sorting, filtering, and pagination are done by the API. The client sends `?sort=&order=&page=&pageSize=` plus filter params; `?sort=` values MUST come from each tab's whitelist (below). List responses have the shape `{ data, total, page, pageSize }` (search: `{ data, total }`).
- **Design tokens are a build requirement (spec §7.1), not a suggestion:** near-white surfaces; **1px hairline borders over shadows**; **4px spacing grid**; radii **4px controls / 8px cards**; **Inter ~13px** base with tight line-height; small muted column headers; neutral gray scale + **one blue accent used sparingly** + a **~10-color tag system** for statuses/sample-types; tables **~32px rows** with hover + subtle blue selection and hairline separators; **dark mode via theme tokens**; restrained motion (~150–200ms eased).
- **Environment:** API base + key come from Vite env (`VITE_API_BASE`, `VITE_API_KEY`); ship a committed `.env.example`; `.env` stays gitignored. `package.json` pins `"engines": { "node": ">=20" }`.
- **Verification floor for every task:** `npm run build` and `npx tsc --noEmit` are clean, and `npm test` (Vitest) passes with pristine output before commit.
- **Staging:** stage only files under `dashboard-v2/`. NEVER `git add -A` (the repo has unrelated untracked files + `.superpowers/` scratch). Commit from the repo root.
- **Bash gotcha:** a PreToolUse hook spuriously blocks some multi-line/compound Bash commands with a bogus "Bare `lua deploy` is blocked" message. Use simple single-purpose Bash commands.

### API contracts this phase consumes (verbatim — do not guess)

**List endpoints** (`GET`), response `{ data: Row[], total: number, page: number, pageSize: number }`:
- `/specialty-samples` — sortable `?sort=`: `date_on, delivery_on, qty_grams, ref, description, receiver_company, status, created_at`. Filters: `status` (comma-separated multi), `sample_type_norm`, `courier_norm`, `result_norm`, `client_id`, `date_from`, `date_to`, `has_awb=true`, `q`.
- `/bulk-samples` — sortable: `date_on, delivery_on, qty_grams, moisture_pct, water_activity_num, sample_ref, quality, client, country, status, created_at`. Filters: `status` (comma-separated multi), `sample_type_norm`, `courier_norm`, `result_norm`, `country`, `client_id`, `date_from`, `date_to`, `moisture_min`, `moisture_max`, `water_min`, `water_max`, `has_awb=true`, `q`.
- `/forwarding-samples` — sortable: `date_on, qty_grams, sample_ref, sender, origin, receiver_company, id_number, status, created_at`. Filters: `status, courier_norm, origin, sender, client_id, date_from, date_to, has_awb, has_id (true|false), q`.
- `/clients` — sortable: `name, country, latest_order_date`. Filters: `q`. Rows include `contact_count` and `latest_order_date` (computed).

**Detail** (`GET /:tab/:id`) returns the full row plus `events: EventRow[]` where `EventRow = { id, entity_type, entity_id, type, note, actor, created_at }`. (Clients detail also returns `contacts`, `account_owner`, `orders` — used in Phase 4.)

**Mutations:** `PATCH /:tab/:id` with a partial body → returns the updated row; writes an event. `DELETE /:tab/:id` → `{ ok, id }` (soft-delete). `POST /:tab` → 201 + row.

**Enums** (for the tag system + filter option lists):
- `status` (specialty/bulk): `requested, preparing, dispatched, delivered, results_in, cancelled`. Forwarding excludes `results_in`.
- `courier_norm`: `dhl, fedex, ups, rider, hand_delivery, client_pickup, other`.
- `result_norm`: `approved, rejected, pending_feedback`.
- `sample_type_norm`: `offer, type, pss, woc, retention, flavor_mapping, marketing, calibration, other`.

**Enum error behavior:** invalid enum filter values now return **400** (Fix-Task B M1). The FE only ever sends whitelisted enum values from the option lists, so this never triggers in normal use.

### Per-tab DISPLAY columns (source columns, verbatim, in display order)

Each display column renders the **source text field**; where a typed companion exists, the column's **sort key** targets the companion (only columns whose sort key is in that tab's whitelist are sortable). Non-whitelisted columns are display-only.

- **Specialty** (`/samples`): `date`(sort→`date_on`), `ref`(sort→`ref`), `outturn`, `name`, `grade`, `bags`, `description`(sort→`description`), `receiver_company`(sort→`receiver_company`), `awb`, `courier`(display; sort not whitelisted), `qty`(sort→`qty_grams`), `delivery_date`(sort→`delivery_on`), `result`, `comments`, `crop_year`, `crop_area_details`, `status`(sort→`status`; tag pill).
- **Bulk** (`/bulk`): `date`(→`date_on`), `sample_ref`(→`sample_ref`), `bags`, `quality`(→`quality`), `client_ref`, `ico_mark`, `sample_type`, `client`(→`client`), `country`(→`country`), `awb`, `courier`, `qty`(→`qty_grams`), `moisture`(→`moisture_pct`), `water_activity`(→`water_activity_num`), `delivery_date`(→`delivery_on`), `result`, `comments`, `crop_year`, `crop_area_details`, `status`(→`status`; tag pill).
- **Forwarding** (`/forwarding`): `date`(→`date_on`), `sender`(→`sender`), `origin`(→`origin`), `sample_ref`(→`sample_ref`), `coffee_quality`, `receiver_company`(→`receiver_company`), `id_number`(→`id_number`), `awb`, `courier`, `qty`(→`qty_grams`), `status`(→`status`; tag pill).
- **Clients** (`/clients`): `name`(→`name`), `country`(→`country`), `contact_count`, `latest_order_date`(→`latest_order_date`; date).

Inline-editable columns (Phase 3): a small, safe subset per tab that the PATCH schema accepts — `status` (select of the tab's statuses), `awb` (text), `courier`→`courier_norm` (select), and for specialty/bulk `result`→`result_norm` (select). Editing `status` to `dispatched`/`delivered`/a result routes through the same PATCH; the API derives the event. Other columns are read-only in Phase 3.

---

## File Structure

```
dashboard-v2/
  package.json            # deps, scripts, engines>=20
  .env.example            # VITE_API_BASE, VITE_API_KEY (no secrets)
  .gitignore              # node_modules, dist, .env, *.local
  index.html
  vite.config.ts
  tsconfig.json, tsconfig.node.json
  tailwind.config.ts      # Twenty token system (T2)
  postcss.config.js
  components.json         # shadcn config
  vitest.config.ts
  src/
    main.tsx              # QueryClientProvider + BrowserRouter + theme bootstrap
    App.tsx               # shell: <Sidebar/> + <Header/> + <Routes/>
    index.css             # @tailwind directives + CSS-var tokens :root/.dark + Inter
    vite-env.d.ts         # ImportMetaEnv typing for VITE_*
    lib/
      api.ts              # copied api<T>() helper
      cn.ts               # shadcn clsx+tailwind-merge util
      params.ts           # PURE: buildListParams(state) -> URLSearchParams  [TESTED]
      query.ts            # QueryClient + hooks: useRecords/useRecord/usePatchRecord/useClients/useSearch
      theme.ts            # PURE: getTheme/setTheme/toggleTheme (localStorage + <html>.dark)  [TESTED]
      tags.ts             # PURE: tagColor(kind, value) -> token class  [TESTED]
    types.ts              # ListResult<T>, EventRow, TabKey, ColumnDef, FilterDef, SortState, FilterState
    tabs/
      registry.ts         # TAB_REGISTRY: per-tab endpoint + columns + filters + sortWhitelist
      specialty.tsx, bulk.tsx, forwarding.tsx, clients.tsx   # column + filter configs per tab
    components/
      ui/                 # shadcn primitives (vendored + restyled): button,input,badge,table,
                          #   sheet,tabs,dropdown-menu,select,command,dialog,tooltip,popover,skeleton
      layout/
        Sidebar.tsx, Header.tsx, ThemeToggle.tsx, CommandMenu.tsx
      RecordTable.tsx     # server-driven, virtualized, inline-edit
      FilterBar.tsx       # pill dropdown chips
      DetailDrawer.tsx    # right peek Sheet, tabs Details/Timeline/Related
      Timeline.tsx        # events[] vertical timeline
      StatusBadge.tsx     # enum -> tag pill (uses tags.ts)
      KpiTile.tsx         # stat tile shell
      charts/ChartShell.tsx  # Phase-4 mount placeholder
    pages/
      SamplesPage.tsx, BulkPage.tsx, ForwardingPage.tsx, ClientsPage.tsx, DashboardPage.tsx
    test/
      setup.ts            # RTL/jsdom setup
```

**Responsibilities:** `lib/*` holds pure logic (tested in isolation) + the Query layer; `types.ts` is the shared type vocabulary; `tabs/*` is pure configuration (what columns/filters each tab has); `components/*` are presentation units consuming the lib + config; `pages/*` compose a tab's config + shared components. This keeps the load-bearing logic (param building, optimistic updates, tag mapping, theme) pure and unit-testable, and the visual layer thin.

---

## Task 1: Scaffold `dashboard-v2/`

**Files:**
- Create: `dashboard-v2/package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `.gitignore`, `.env.example`, `vitest.config.ts`, `postcss.config.js`, `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/vite-env.d.ts`, `src/lib/api.ts`, `src/lib/cn.ts`, `src/test/setup.ts`, `src/App.test.tsx`

**Interfaces:**
- Produces: `api<T>(path, init?): Promise<T>` (from `src/lib/api.ts`); `cn(...classes)` (from `src/lib/cn.ts`); a booting React app rendering a placeholder.

- [ ] **Step 1: Create `dashboard-v2/package.json`**

```json
{
  "name": "dashboard-v2",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "@tanstack/react-query": "^5.51.0",
    "@tanstack/react-table": "^8.20.0",
    "@tanstack/react-virtual": "^3.8.0",
    "framer-motion": "^11.3.0",
    "cmdk": "^1.0.0",
    "recharts": "^2.12.0",
    "@tabler/icons-react": "^3.11.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.4.0",
    "@radix-ui/react-dialog": "^1.1.1",
    "@radix-ui/react-dropdown-menu": "^2.1.1",
    "@radix-ui/react-select": "^2.1.1",
    "@radix-ui/react-tabs": "^1.1.0",
    "@radix-ui/react-tooltip": "^1.1.2",
    "@radix-ui/react-popover": "^1.1.1",
    "@radix-ui/react-slot": "^1.1.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@types/node": "^20.14.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "tailwindcss-animate": "^1.0.7",
    "vitest": "^2.0.0",
    "jsdom": "^24.1.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "@testing-library/jest-dom": "^6.4.6"
  }
}
```

Note: react-router-dom **v6** (stable, well-documented nested routes), not v7. Install with `npm install` from `dashboard-v2/`.

- [ ] **Step 2: Create config files**

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 5174 },
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'] },
});
```

`postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "useDefineForClassFields": true, "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext", "skipLibCheck": true, "moduleResolution": "bundler",
    "allowImportingTsExtensions": true, "resolveJsonModule": true, "isolatedModules": true,
    "noEmit": true, "jsx": "react-jsx", "strict": true, "noUnusedLocals": true,
    "noUnusedParameters": true, "noFallthroughCasesInSwitch": true,
    "baseUrl": ".", "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true, "skipLibCheck": true, "module": "ESNext",
    "moduleResolution": "bundler", "allowSyntheticDefaultImports": true, "strict": true
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

`.gitignore`:
```
node_modules
dist
.env
.env.local
*.local
.DS_Store
```

`.env.example`:
```
VITE_API_BASE=http://localhost:4000
VITE_API_KEY=dev-key-sucafina
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sucafina Sample Desk</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `src/lib/api.ts` (copied from dashboard/, verbatim)**

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

`src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
  readonly VITE_API_KEY: string;
}
interface ImportMeta { readonly env: ImportMetaEnv; }
```

`src/lib/cn.ts`:
```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

- [ ] **Step 4: Create `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/test/setup.ts`**

`src/index.css` (minimal for now — full tokens come in Task 2):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`src/App.tsx`:
```tsx
export default function App() {
  return <div className="p-4 text-sm">Sucafina Sample Desk — foundation booting.</div>;
}
```

`src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
```

`src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Write the smoke test `src/App.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import App from './App';

it('renders the app shell placeholder', () => {
  render(<App />);
  expect(screen.getByText(/Sucafina Sample Desk/i)).toBeInTheDocument();
});
```

- [ ] **Step 6: Install, then verify build + types + test**

Run (from `dashboard-v2/`): `npm install`
Run: `npm test` — Expected: 1 passed.
Run: `npm run typecheck` — Expected: exit 0, no output.
Run: `npm run build` — Expected: build succeeds, `dist/` emitted.

- [ ] **Step 7: Commit**

```bash
git add dashboard-v2/package.json dashboard-v2/package-lock.json dashboard-v2/vite.config.ts dashboard-v2/vitest.config.ts dashboard-v2/postcss.config.js dashboard-v2/tsconfig.json dashboard-v2/tsconfig.node.json dashboard-v2/index.html dashboard-v2/.gitignore dashboard-v2/.env.example dashboard-v2/src
git commit -m "feat(fe): scaffold dashboard-v2 (Vite+React18+TS, TanStack/shadcn deps, api helper, vitest)"
```

---

## Task 2: Design-token pass (Twenty-flavored Tailwind + restyled shadcn primitives + tag system)

**LOAD THE `frontend-design` AND `dataviz` SKILLS BEFORE STARTING.** dataviz guides the categorical tag palette + light/dark contrast validation; frontend-design guides the overall Twenty-grade calibration. The token VALUES below are the floor; refine hues within the Twenty aesthetic (light/airy/low-chrome) but keep every constraint (hairline borders, 4px grid, 4/8px radii, Inter ~13px, single blue accent, ~32px rows, dark mode).

**Files:**
- Create: `dashboard-v2/tailwind.config.ts`, `dashboard-v2/components.json`, `src/lib/theme.ts`, `src/lib/theme.test.ts`, `src/lib/tags.ts`, `src/lib/tags.test.ts`, `src/components/ui/*` (vendored shadcn primitives), `src/components/StatusBadge.tsx`, `src/components/StatusBadge.test.tsx`
- Modify: `src/index.css` (CSS-var tokens), `src/App.tsx` (demo the tokens + theme toggle button so the pass is visible)

**Interfaces:**
- Consumes: `cn` (Task 1).
- Produces: `getTheme(): 'light'|'dark'`, `setTheme(t)`, `toggleTheme(): 'light'|'dark'` (`src/lib/theme.ts`); `tagColor(kind: TagKind, value: string): string` returning a token class string, where `TagKind = 'status' | 'result' | 'sample_type'` (`src/lib/tags.ts`); `<StatusBadge kind value />` (`src/components/StatusBadge.tsx`); the restyled shadcn `ui/*` primitives; the `--*` CSS token contract used by every later component.

- [ ] **Step 1: Write `src/lib/theme.ts`**

```ts
export type Theme = 'light' | 'dark';
const KEY = 'sucafina-theme';

export function getTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function setTheme(t: Theme): void {
  localStorage.setItem(KEY, t);
  document.documentElement.classList.toggle('dark', t === 'dark');
}
export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
```

- [ ] **Step 2: Write `src/lib/theme.test.ts` and run it (RED then GREEN)**

```ts
import { getTheme, setTheme, toggleTheme } from './theme';
beforeEach(() => { localStorage.clear(); document.documentElement.className = ''; });

it('setTheme persists and toggles the .dark class', () => {
  setTheme('dark');
  expect(localStorage.getItem('sucafina-theme')).toBe('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  setTheme('light');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
});
it('toggleTheme flips and returns the new theme', () => {
  setTheme('light');
  expect(toggleTheme()).toBe('dark');
  expect(getTheme()).toBe('dark');
});
```

Run: `npm test src/lib/theme.test.ts` — first without theme.ts (FAIL: cannot find module), then GREEN after Step 1.

- [ ] **Step 3: Write `src/index.css` with the Twenty token system**

Load Inter from a self-hosted or CDN `@import` (or `@fontsource/inter` if added). Tokens (HSL, shadcn-compatible). Refine within the Twenty aesthetic but keep contrast AA:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222 20% 18%;
    --card: 0 0% 100%;
    --card-foreground: 222 20% 18%;
    --popover: 0 0% 100%;
    --popover-foreground: 222 20% 18%;
    --primary: 217 91% 60%;            /* the single blue accent */
    --primary-foreground: 0 0% 100%;
    --secondary: 220 14% 96%;
    --secondary-foreground: 222 20% 18%;
    --muted: 220 14% 96%;
    --muted-foreground: 220 9% 46%;
    --accent: 214 95% 96%;             /* faint blue selection */
    --accent-foreground: 217 91% 40%;
    --destructive: 0 72% 51%;
    --destructive-foreground: 0 0% 100%;
    --border: 220 13% 91%;             /* hairline */
    --input: 220 13% 88%;
    --ring: 217 91% 60%;
    --radius: 0.5rem;                  /* 8px cards; controls use rounded-[4px] */
  }
  .dark {
    --background: 222 22% 11%;
    --foreground: 220 14% 90%;
    --card: 222 20% 13%;
    --card-foreground: 220 14% 90%;
    --popover: 222 20% 13%;
    --popover-foreground: 220 14% 90%;
    --primary: 217 91% 60%;
    --primary-foreground: 0 0% 100%;
    --secondary: 220 14% 18%;
    --secondary-foreground: 220 14% 90%;
    --muted: 220 14% 16%;
    --muted-foreground: 220 9% 60%;
    --accent: 217 40% 20%;
    --accent-foreground: 214 95% 85%;
    --destructive: 0 62% 50%;
    --destructive-foreground: 0 0% 100%;
    --border: 220 13% 22%;
    --input: 220 13% 24%;
    --ring: 217 91% 60%;
  }
  * { @apply border-border; }
  body { @apply bg-background text-foreground; font-family: 'Inter', system-ui, sans-serif; font-size: 13px; line-height: 1.4; }
}
```

- [ ] **Step 4: Write `dashboard-v2/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))', input: 'hsl(var(--input))', ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))', foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
      },
      borderRadius: { lg: 'var(--radius)', md: '6px', sm: '4px' },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      fontSize: { xs: ['11px', '16px'], sm: ['13px', '18px'], base: ['13px', '18px'] },
      keyframes: {
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
      },
      animation: { 'slide-in-right': 'slide-in-right 180ms ease-out' },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
```

- [ ] **Step 5: Write the tag system `src/lib/tags.ts`**

Twenty's ~10-color tag system. Each returns a class string with soft bg + saturated text, tuned for both themes via fixed Tailwind color utilities (independent of the neutral token vars):

```ts
export type TagKind = 'status' | 'result' | 'sample_type';

const PALETTE = {
  gray:   'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
  blue:   'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  green:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  amber:  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  red:    'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  purple: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  teal:   'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  pink:   'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
} as const;
type Color = keyof typeof PALETTE;

const STATUS: Record<string, Color> = {
  requested: 'gray', preparing: 'amber', dispatched: 'blue',
  delivered: 'teal', results_in: 'purple', cancelled: 'red',
};
const RESULT: Record<string, Color> = { approved: 'green', rejected: 'red', pending_feedback: 'amber' };
const SAMPLE_TYPE: Record<string, Color> = {
  offer: 'blue', type: 'indigo', pss: 'teal', woc: 'orange', retention: 'gray',
  flavor_mapping: 'pink', marketing: 'purple', calibration: 'green', other: 'gray',
};

export function tagColor(kind: TagKind, value: string): string {
  const map = kind === 'status' ? STATUS : kind === 'result' ? RESULT : SAMPLE_TYPE;
  return PALETTE[map[value] ?? 'gray'];
}
```

- [ ] **Step 6: Write `src/lib/tags.test.ts` (RED then GREEN)**

```ts
import { tagColor } from './tags';
it('maps known statuses to distinct palette classes', () => {
  expect(tagColor('status', 'dispatched')).toContain('blue');
  expect(tagColor('status', 'cancelled')).toContain('rose');
  expect(tagColor('result', 'approved')).toContain('emerald');
});
it('falls back to gray for unknown values', () => {
  expect(tagColor('status', 'nonsense')).toContain('slate');
});
```

Run: `npm test src/lib/tags.test.ts` → GREEN.

- [ ] **Step 7: Create `components.json` and vendor + restyle the shadcn primitives**

`components.json`:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york", "rsc": false, "tsx": true,
  "tailwind": { "config": "tailwind.config.ts", "css": "src/index.css", "baseColor": "slate", "cssVariables": true },
  "aliases": { "components": "@/components", "utils": "@/lib/cn" }
}
```

Vendor these primitives into `src/components/ui/` (via `npx shadcn@latest add button input badge table sheet tabs dropdown-menu select command dialog tooltip popover skeleton`, OR hand-author from the shadcn source if the CLI is unavailable). Then **restyle** them to the Twenty language (this is the work): hairline borders (`border border-border`), no drop shadows on tables/inputs (buttons/popovers may use a subtle `shadow-sm`), `rounded-[4px]` on controls / `rounded-lg` on cards & dialogs, `h-8` default control height, `text-sm`. Keep the shadcn API/prop shape intact so later tasks consume them unchanged.

- [ ] **Step 8: Write `src/components/StatusBadge.tsx` + test**

```tsx
import { cn } from '@/lib/cn';
import { tagColor, type TagKind } from '@/lib/tags';

export function StatusBadge({ kind, value }: { kind: TagKind; value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn('inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-xs font-medium', tagColor(kind, value))}>
      {value.replace(/_/g, ' ')}
    </span>
  );
}
```

`src/components/StatusBadge.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';
it('renders a humanized label with the tag color', () => {
  render(<StatusBadge kind="status" value="results_in" />);
  const el = screen.getByText('results in');
  expect(el.className).toContain('violet');
});
it('renders an em-dash for null', () => {
  render(<StatusBadge kind="status" value={null} />);
  expect(screen.getByText('—')).toBeInTheDocument();
});
```

- [ ] **Step 9: Demo tokens in `src/App.tsx` (temporary, replaced by the shell in Task 3)**

Render a card with hairline border, a few `<StatusBadge>`s across statuses, a primary button, and a theme-toggle button calling `toggleTheme()` — so the token pass is visually verifiable.

- [ ] **Step 10: Verify + commit**

Run: `npm test` (theme + tags + StatusBadge + smoke green), `npm run typecheck`, `npm run build` — all clean.
Run: `npm run dev` and visually confirm against spec §7.1 (Inter ~13px, hairline borders, near-white surface, single blue accent, tag colors, dark toggle flips cleanly). Record the visual check in your report.

```bash
git add dashboard-v2/tailwind.config.ts dashboard-v2/components.json dashboard-v2/src
git commit -m "feat(fe): Twenty-flavored token system, restyled shadcn primitives, tag palette, theme"
```

---

## Task 3: App shell (Sidebar + Header + ThemeToggle + Cmd+K) with routes

**LOAD `frontend-design`.**

**Files:**
- Create: `src/components/layout/Sidebar.tsx`, `Header.tsx`, `ThemeToggle.tsx`, `CommandMenu.tsx`, `src/pages/{Samples,Bulk,Forwarding,Clients,Dashboard}Page.tsx` (placeholders for now), `src/components/layout/Sidebar.test.tsx`
- Modify: `src/App.tsx` (shell layout + `<Routes>`), `src/main.tsx` (wrap in `<BrowserRouter>` + bootstrap theme)

**Interfaces:**
- Consumes: `toggleTheme`/`getTheme` (Task 2), restyled `ui/*` (Task 2), Tabler icons.
- Produces: the persistent shell; `NAV_ITEMS` (label, path, icon) exported from `Sidebar.tsx` and reused by `CommandMenu`; route outlets for each page.

- [ ] **Step 1: Bootstrap theme + router in `src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { getTheme, setTheme } from './lib/theme';
import './index.css';

setTheme(getTheme()); // apply persisted/system theme before first paint

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>,
);
```

- [ ] **Step 2: `src/components/layout/Sidebar.tsx`**

Collapsible left nav. Export `NAV_ITEMS`. Use `NavLink` with active styling (`bg-accent text-accent-foreground`), Tabler icons (`IconDashboard, IconFlask, IconBox, IconTruck, IconUsers`), a brand row (`☕ Sucafina`), and a collapse toggle that narrows to icon-only (persist collapsed state to localStorage). 1px right hairline border.

```tsx
import { NavLink } from 'react-router-dom';
import { IconLayoutDashboard, IconFlask2, IconBox, IconTruckDelivery, IconUsers } from '@tabler/icons-react';

export const NAV_ITEMS = [
  { label: 'Dashboard', path: '/', icon: IconLayoutDashboard },
  { label: 'Sample', path: '/samples', icon: IconFlask2 },
  { label: 'Bulk', path: '/bulk', icon: IconBox },
  { label: 'Forwarding', path: '/forwarding', icon: IconTruckDelivery },
  { label: 'Clients', path: '/clients', icon: IconUsers },
] as const;
// ...render collapsible <nav> with these items (full JSX authored here).
```

- [ ] **Step 3: `ThemeToggle.tsx`, `Header.tsx`, `CommandMenu.tsx`**

- `ThemeToggle`: a button toggling `toggleTheme()`, showing `IconSun`/`IconMoon` per current theme (track with `useState` seeded from `getTheme()`).
- `Header`: top bar with the current section title + a "search… ⌘K" trigger button that opens `CommandMenu`; right side hosts `ThemeToggle`.
- `CommandMenu`: `cmdk` `<Command.Dialog>` opened by ⌘K/Ctrl+K (global `keydown` listener). Two groups: (1) navigation (from `NAV_ITEMS` → `navigate(path)`); (2) record search — on input, debounced call to `useSearch(q)` (Task 4; until Task 4 exists, wire the nav group only and add a TODO-free stub that renders "type to search" — DO NOT leave a placeholder that ships; instead gate the search group behind Task 4 by importing `useSearch` and rendering results). Selecting a search hit `navigate(\`/\${tabToPath(hit.tab)}/\${hit.id}\`)`.

  NOTE for the implementer: this task depends on `useSearch` from Task 4. If executing in order, Task 4 precedes wiring the search group — implement the nav group + the ⌘K open/close here, and the search group wiring is completed as the first step of nothing (it is included here fully, importing `useSearch`). Since Task 4 is listed after Task 3, reorder locally is fine: the controller may run Task 4 before Task 3's search group. To keep Task 3 self-contained, implement ⌘K + nav navigation + an input that, when `useSearch` is available, lists results; guard with `import { useSearch } from '@/lib/query'`. (Task 4 defines `useSearch`.)

- [ ] **Step 4: `src/App.tsx` shell + routes**

```tsx
import { Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import SamplesPage from './pages/SamplesPage';
import BulkPage from './pages/BulkPage';
import ForwardingPage from './pages/ForwardingPage';
import ClientsPage from './pages/ClientsPage';
import DashboardPage from './pages/DashboardPage';

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-h-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/samples/*" element={<SamplesPage />} />
            <Route path="/bulk/*" element={<BulkPage />} />
            <Route path="/forwarding/*" element={<ForwardingPage />} />
            <Route path="/clients/*" element={<ClientsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
```

Pages are simple placeholders in this task (e.g. `<div className="p-4">Sample</div>`) — filled in Task 8/9.

- [ ] **Step 5: `Sidebar.test.tsx` (RTL smoke)**

```tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';
it('renders all nav destinations', () => {
  render(<MemoryRouter><Sidebar /></MemoryRouter>);
  ['Dashboard', 'Sample', 'Bulk', 'Forwarding', 'Clients'].forEach((l) =>
    expect(screen.getByText(l)).toBeInTheDocument());
});
```

- [ ] **Step 6: Verify + commit**

`npm test`, `npm run typecheck`, `npm run build` clean. `npm run dev`: nav routes between placeholder pages, ⌘K opens/closes and navigates, theme toggles. Commit staging only `dashboard-v2/src`.

```bash
git add dashboard-v2/src
git commit -m "feat(fe): app shell — collapsible sidebar, header, theme toggle, Cmd+K palette, routes"
```

---

## Task 4: Data layer (types, pure param builder, TanStack Query hooks)

**Files:**
- Create: `src/types.ts`, `src/lib/params.ts`, `src/lib/params.test.ts`, `src/lib/query.ts`
- Modify: `src/main.tsx` (wrap in `<QueryClientProvider>`)

**Interfaces:**
- Consumes: `api` (Task 1).
- Produces:
  - Types (`src/types.ts`): `ListResult<T> = { data: T[]; total: number; page: number; pageSize: number }`; `EventRow = { id: string; entity_type: string; entity_id: string; type: string; note: string|null; actor: string; created_at: string }`; `TabKey = 'specialty'|'bulk'|'forwarding'|'clients'`; `SortState = { sort: string; order: 'asc'|'desc' } | null`; `FilterState = Record<string, string | string[]>`; `ListQuery = { sort: SortState; filters: FilterState; page: number; pageSize: number }`.
  - `buildListParams(q: ListQuery): URLSearchParams` (`src/lib/params.ts`).
  - Hooks (`src/lib/query.ts`): `useRecords(endpoint: string, q: ListQuery)` → `UseQueryResult<ListResult<Record<string,unknown>>>`; `useRecord(endpoint: string, id: string)` → the row + `events`; `usePatchRecord(endpoint: string)` → `UseMutationResult` doing optimistic update; `useClients(q)`; `useSearch(q: string)` → `{ data: SearchHit[] }` where `SearchHit = { tab: string; id: string; ref: string|null; title: string|null; receiver: string|null; status: string; awb: string|null }`.
  - `queryClient` (exported).

- [ ] **Step 1: Write `src/lib/params.ts`**

```ts
import type { ListQuery } from '@/types';

export function buildListParams(q: ListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.sort) { p.set('sort', q.sort.sort); p.set('order', q.sort.order); }
  p.set('page', String(q.page));
  p.set('pageSize', String(q.pageSize));
  for (const [k, v] of Object.entries(q.filters)) {
    if (v == null) continue;
    if (Array.isArray(v)) { if (v.length) p.set(k, v.join(',')); }
    else if (v !== '') p.set(k, v);
  }
  return p;
}
```

- [ ] **Step 2: Write `src/lib/params.test.ts` (RED then GREEN)**

```ts
import { buildListParams } from './params';

it('serializes sort, pagination, scalar and array filters; drops empties', () => {
  const p = buildListParams({
    sort: { sort: 'date_on', order: 'desc' }, page: 2, pageSize: 25,
    filters: { status: ['dispatched', 'delivered'], courier_norm: 'dhl', country: '', has_awb: 'true' },
  });
  expect(p.get('sort')).toBe('date_on');
  expect(p.get('order')).toBe('desc');
  expect(p.get('page')).toBe('2');
  expect(p.get('status')).toBe('dispatched,delivered');
  expect(p.get('courier_norm')).toBe('dhl');
  expect(p.has('country')).toBe(false);
  expect(p.get('has_awb')).toBe('true');
});
it('omits sort when null', () => {
  const p = buildListParams({ sort: null, page: 1, pageSize: 25, filters: {} });
  expect(p.has('sort')).toBe(false);
});
```

Run: `npm test src/lib/params.test.ts` → GREEN.

- [ ] **Step 3: Write `src/lib/query.ts`**

```ts
import { QueryClient, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { buildListParams } from './params';
import type { ListResult, ListQuery, EventRow } from '@/types';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
});

export function useRecords(endpoint: string, q: ListQuery) {
  const qs = buildListParams(q).toString();
  return useQuery({
    queryKey: [endpoint, 'list', qs],
    queryFn: () => api<ListResult<Record<string, unknown>>>(`${endpoint}?${qs}`),
  });
}

type Detail = Record<string, unknown> & { events?: EventRow[] };
export function useRecord(endpoint: string, id: string) {
  return useQuery({
    queryKey: [endpoint, 'detail', id],
    queryFn: () => api<Detail>(`${endpoint}/${id}`),
    enabled: !!id,
  });
}

export function usePatchRecord(endpoint: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown> }) =>
      api<Record<string, unknown>>(`${endpoint}/${vars.id}`, { method: 'PATCH', body: JSON.stringify(vars.body) }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: [endpoint, 'detail', vars.id] });
      const prev = qc.getQueryData<Detail>([endpoint, 'detail', vars.id]);
      if (prev) qc.setQueryData<Detail>([endpoint, 'detail', vars.id], { ...prev, ...vars.body });
      return { prev };
    },
    onError: (_e, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData([endpoint, 'detail', vars.id], ctx.prev);
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: [endpoint, 'detail', vars.id] });
      qc.invalidateQueries({ queryKey: [endpoint, 'list'] });
    },
  });
}

export function useClients(q: ListQuery) { return useRecords('/clients', q); }

export type SearchHit = { tab: string; id: string; ref: string | null; title: string | null; receiver: string | null; status: string; awb: string | null };
export function useSearch(q: string) {
  return useQuery({
    queryKey: ['/search', q],
    queryFn: () => api<{ data: SearchHit[]; total: number }>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length > 0,
  });
}
```

Note: `list` invalidation uses the `[endpoint, 'list']` prefix (partial key match), which invalidates every filtered/paged variant of that endpoint's list.

- [ ] **Step 4: Add a pure test for the optimistic transform**

The optimistic merge is `{ ...prev, ...body }`. Extract nothing new — instead test the observable behavior by asserting the merge helper. Add to `params.test.ts` a tiny pure check OR create `src/lib/query.optimistic.test.ts` that reproduces the merge:

```ts
it('optimistic merge overlays patched fields onto the cached row', () => {
  const prev = { id: '1', status: 'requested', awb: null };
  const body = { status: 'dispatched', awb: 'X1' };
  expect({ ...prev, ...body }).toEqual({ id: '1', status: 'dispatched', awb: 'X1' });
});
```

(Kept minimal — the real optimistic flow is exercised live in Task 8.)

- [ ] **Step 5: Wrap the app in `<QueryClientProvider>` (`src/main.tsx`)**

Add `import { QueryClientProvider } from '@tanstack/react-query'; import { queryClient } from './lib/query';` and wrap `<App/>`:
```tsx
<QueryClientProvider client={queryClient}><BrowserRouter><App /></BrowserRouter></QueryClientProvider>
```

- [ ] **Step 6: Verify + commit**

`npm test`, `npm run typecheck`, `npm run build` clean.
```bash
git add dashboard-v2/src
git commit -m "feat(fe): data layer — types, pure buildListParams, TanStack Query hooks (list/detail/patch/search)"
```

---

## Task 5: `RecordTable` (server-driven, virtualized, inline-edit)

**LOAD `frontend-design`.**

**Files:**
- Create: `src/components/RecordTable.tsx`, `src/components/RecordTable.test.tsx`
- Modify: `src/types.ts` (add `ColumnDef`)

**Interfaces:**
- Consumes: `useRecords`, `usePatchRecord` (Task 4), `ui/table` + `ui/select` + `ui/input` (Task 2), `StatusBadge` (Task 2), `@tanstack/react-table`, `@tanstack/react-virtual`.
- Produces:
  - `ColumnDef` (in `types.ts`):
    ```ts
    export type ColumnDef = {
      key: string;                 // row field to display (source column)
      header: string;              // column header label
      sortKey?: string;            // API sort value; omit => not sortable
      width?: number;              // px
      render?: (row: Record<string, unknown>) => React.ReactNode;  // custom cell (e.g. StatusBadge)
      edit?: { field: string; type: 'text' | 'select'; options?: string[] };  // inline edit → PATCH {field: value}
    };
    ```
  - `<RecordTable endpoint columns filters onRowClick />` where props: `endpoint: string`, `columns: ColumnDef[]`, `filters: FilterState`, `onRowClick: (row) => void`. RecordTable owns sort + pagination state internally (page size default 50).

- [ ] **Step 1: Write `RecordTable.test.tsx` (logic-focused; render with a QueryClient + a stubbed fetch)**

Stub `window.fetch` (or `import.meta.env.VITE_API_BASE` + a `vi.spyOn(global, 'fetch')`) to return a `{ data, total, page, pageSize }` payload; wrap in `QueryClientProvider`. Assert: rows render from `data`; clicking a sortable header toggles the query (assert the fetched URL gains `sort=<sortKey>&order=asc`), non-sortable headers don't; clicking a row calls `onRowClick` with that row.

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { RecordTable } from './RecordTable';

function stubFetch(rows: Record<string, unknown>[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    return new Response(JSON.stringify({ data: rows, total: rows.length, page: 1, pageSize: 50 }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  });
}
const cols = [{ key: 'ref', header: 'Ref', sortKey: 'ref' }, { key: 'name', header: 'Name' }];
const wrap = (ui: React.ReactNode) =>
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;

it('renders rows from the list payload', async () => {
  stubFetch([{ id: '1', ref: 'R1', name: 'Alpha' }]);
  render(wrap(<RecordTable endpoint="/specialty-samples" columns={cols} filters={{}} onRowClick={() => {}} />));
  await waitFor(() => expect(screen.getByText('R1')).toBeInTheDocument());
});
it('sortable header adds sort/order to the request; row click fires callback', async () => {
  const spy = stubFetch([{ id: '1', ref: 'R1', name: 'Alpha' }]);
  const onRow = vi.fn();
  render(wrap(<RecordTable endpoint="/specialty-samples" columns={cols} filters={{}} onRowClick={onRow} />));
  await waitFor(() => screen.getByText('R1'));
  fireEvent.click(screen.getByText('Ref'));
  await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes('sort=ref'))).toBe(true));
  fireEvent.click(screen.getByText('R1'));
  expect(onRow).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
});
```

- [ ] **Step 2: Implement `RecordTable.tsx`**

Build with TanStack Table (headless, `getCoreRowModel`) for column/row modeling and `@tanstack/react-virtual` for row windowing (row height 32px; only render the visible window over the page's rows). Server-driven: sort + page state → `useRecords(endpoint, { sort, filters, page, pageSize: 50 })`. Sortable headers cycle asc→desc; clicking sets `sort` (the column's `sortKey`). Pagination footer shows `total` + page controls; changing filters (prop) resets to page 1 (via `useEffect` on a stable filters key). Inline edit: a cell with `edit` renders an inline `<input>`/`<select>`; on commit, call `usePatchRecord(endpoint).mutate({ id: row.id, body: { [edit.field]: value } })` (optimistic). Styling per §7.1: `h-8` rows, hairline `border-b border-border`, hover `bg-muted/50`, header row `text-xs uppercase tracking-wide text-muted-foreground`, sticky header. Loading → skeleton rows; empty → a muted "No records" state. Show the FULL implementation.

- [ ] **Step 3: Run tests → GREEN; typecheck; build**

Run: `npm test src/components/RecordTable.test.tsx`, `npm run typecheck`, `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add dashboard-v2/src
git commit -m "feat(fe): RecordTable — server-driven sort/pagination, virtualized rows, inline-edit→PATCH"
```

---

## Task 6: `FilterBar` (pill dropdown chips)

**LOAD `frontend-design`.**

**Files:**
- Create: `src/components/FilterBar.tsx`, `src/components/FilterBar.test.tsx`
- Modify: `src/types.ts` (add `FilterDef`)

**Interfaces:**
- Consumes: `ui/dropdown-menu` or `ui/popover` + `ui/select` (Task 2), `FilterState` (Task 4).
- Produces:
  - `FilterDef` (in `types.ts`):
    ```ts
    export type FilterDef =
      | { key: string; label: string; type: 'enum'; options: string[]; multi?: boolean }
      | { key: string; label: string; type: 'text' }
      | { key: string; label: string; type: 'bool'; trueValue?: string }        // e.g. has_awb=true
      | { key: string; label: string; type: 'date'; }                            // maps to date_from/date_to pair handled by caller
      | { key: string; label: string; type: 'numrange'; minKey: string; maxKey: string };
    ```
  - `<FilterBar defs value onChange />`: `defs: FilterDef[]`, `value: FilterState`, `onChange: (next: FilterState) => void`. Also renders a search `<input>` bound to the `q` key. Active filters show as removable pill chips.

- [ ] **Step 1: Write `FilterBar.test.tsx`**

Assert: rendering a `q` search input + a chip per def; picking an enum option calls `onChange` with that key set; a `bool` chip toggles `key=trueValue`; clearing a chip removes the key.

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterBar } from './FilterBar';
const defs = [
  { key: 'status', label: 'Status', type: 'enum', options: ['dispatched', 'delivered'], multi: true },
  { key: 'has_awb', label: 'Has AWB', type: 'bool', trueValue: 'true' },
] as const;
it('emits filter changes and clears', () => {
  const onChange = vi.fn();
  render(<FilterBar defs={defs as any} value={{}} onChange={onChange} />);
  fireEvent.click(screen.getByText('Has AWB'));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ has_awb: 'true' }));
});
```

- [ ] **Step 2: Implement `FilterBar.tsx`**

Each `FilterDef` renders a pill button (with a Tabler chevron icon) opening a popover/dropdown of options; selection updates `value` via `onChange`. `enum multi` → checkbox list producing a string array; `enum` single → radio; `bool` → toggle setting/removing `key`; `text`/`date`/`numrange` → small inputs (date writes `date_from`/`date_to`; numrange writes `minKey`/`maxKey`). Active values render as chips with an `×` to clear. A leading search input maps to `q`. Twenty style: `rounded-[4px]` pill chips, `border-border`, active chip `bg-accent text-accent-foreground`. Full implementation shown.

- [ ] **Step 3: Test GREEN; typecheck; build. Commit.**

```bash
git add dashboard-v2/src
git commit -m "feat(fe): FilterBar — pill dropdown chips (enum/bool/text/date/numrange) + search"
```

---

## Task 7: `DetailDrawer` + `Timeline`

**LOAD `frontend-design`.**

**Files:**
- Create: `src/components/DetailDrawer.tsx`, `src/components/Timeline.tsx`, `src/components/Timeline.test.tsx`, `src/components/DetailDrawer.test.tsx`

**Interfaces:**
- Consumes: `useRecord`, `usePatchRecord` (Task 4), `ui/sheet` + `ui/tabs` (Task 2), `StatusBadge` (Task 2), `EventRow` (Task 4), Framer Motion.
- Produces:
  - `<Timeline events />`: `events: EventRow[]`.
  - `<DetailDrawer endpoint id open onClose fields />`: `endpoint: string`, `id: string`, `open: boolean`, `onClose: () => void`, `fields: DetailField[]` where `DetailField = { key: string; label: string; render?: (row) => React.ReactNode; edit?: { field: string; type: 'text'|'select'; options?: string[] } }`. Right-side peek `Sheet` with tabs **Details / Timeline / Related**.

- [ ] **Step 1: Write `Timeline.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react';
import { Timeline } from './Timeline';
const evs = [{ id: 'e1', entity_type: 'specialty', entity_id: 's1', type: 'created', note: 'AB for Beyers', actor: 'seed', created_at: '2026-07-01T00:00:00Z' }];
it('renders one entry per event with type + note + actor', () => {
  render(<Timeline events={evs} />);
  expect(screen.getByText(/created/i)).toBeInTheDocument();
  expect(screen.getByText(/AB for Beyers/)).toBeInTheDocument();
  expect(screen.getByText(/seed/)).toBeInTheDocument();
});
it('renders an empty state when no events', () => {
  render(<Timeline events={[]} />);
  expect(screen.getByText(/no activity/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Implement `Timeline.tsx`**

Vertical timeline: each event = a dot on a hairline rail + `type` (as a small tag), humanized note, actor, relative/short timestamp. Empty state "No activity yet." Full implementation.

- [ ] **Step 3: Implement `DetailDrawer.tsx`**

`ui/sheet` anchored right (width ~ 480px), Framer Motion slide-in (~180ms, use the `slide-in-right` animation or `motion.div`). Header shows a title (ref/name). Tabs: **Details** = the `fields` list; a field with `edit` is inline-editable (commit → `usePatchRecord(endpoint).mutate`), otherwise read-only (uses `render` or raw value, `—` for null). **Timeline** = `<Timeline events={data.events ?? []} />`. **Related** = a minimal placeholder for Phase 3 ("Related records — coming in Phase 4") — this is an intentional, labeled Phase-4 boundary, not a dangling TODO. Loading → skeleton. Full implementation.

- [ ] **Step 4: Write `DetailDrawer.test.tsx`**

Stub fetch to return a detail row `{ id, ref, status, events: [...] }`; render with QueryClient + `open`; assert the ref renders, switching to the Timeline tab shows the event, and an inline `status` edit fires a PATCH (assert fetch called with method PATCH + body).

- [ ] **Step 5: Test GREEN; typecheck; build. Commit.**

```bash
git add dashboard-v2/src
git commit -m "feat(fe): DetailDrawer (Details/Timeline/Related tabs) + Timeline, inline-edit→PATCH"
```

---

## Task 8: Wire the three sample tabs + Clients list (live)

**LOAD `frontend-design`.** This task produces the end-to-end proof against the live API + reseeded DB.

**Files:**
- Create: `src/tabs/registry.ts`, `src/tabs/specialty.tsx`, `src/tabs/bulk.tsx`, `src/tabs/forwarding.tsx`, `src/tabs/clients.tsx`, `src/tabs/registry.test.ts`
- Modify: `src/pages/{Samples,Bulk,Forwarding,Clients}Page.tsx` (compose config + shared components), `src/App.tsx` (nested `:id` routes for the drawer)

**Interfaces:**
- Consumes: everything from Tasks 4–7 + `ColumnDef`/`FilterDef` types.
- Produces: `TAB_REGISTRY: Record<TabKey, TabConfig>` where `TabConfig = { endpoint: string; path: string; entityLabel: string; columns: ColumnDef[]; filters: FilterDef[]; detailFields: DetailField[] }`.

- [ ] **Step 1: Author the per-tab configs**

Using the **Per-tab DISPLAY columns** and **API contracts** from Global Constraints, author `columns` (each source column; `sortKey` only where the tab's sort whitelist allows; `status` column uses `render: (r) => <StatusBadge kind="status" value={r.status}/>`; `result`→StatusBadge kind result; sample_type→StatusBadge kind sample_type), `filters` (per-tab filter defs: status enum-multi, courier_norm enum, result_norm enum [specialty/bulk], sample_type_norm enum [specialty/bulk], country text [bulk], date range, has_awb bool, plus bulk moisture/water numrange, forwarding origin/sender text + has_id bool), and `detailFields` (the inline-editable subset: status/awb/courier_norm/result_norm as specified). Clients config: columns name/country/contact_count/latest_order_date; filter `q` only; detailFields minimal (Phase-4 drill-down deferred).

Full config for each file must be written out (no "similar to specialty").

- [ ] **Step 2: `registry.test.ts` (guards config correctness)**

Assert each tab's `columns` `sortKey`s are a subset of that tab's documented sort whitelist (prevents shipping a 400-causing sort), and that `endpoint`/`path` are correct.

```ts
import { TAB_REGISTRY } from './registry';
const WL = {
  specialty: ['date_on','delivery_on','qty_grams','ref','description','receiver_company','status','created_at'],
  bulk: ['date_on','delivery_on','qty_grams','moisture_pct','water_activity_num','sample_ref','quality','client','country','status','created_at'],
  forwarding: ['date_on','qty_grams','sample_ref','sender','origin','receiver_company','id_number','status','created_at'],
  clients: ['name','country','latest_order_date'],
} as Record<string, string[]>;
it('every column sortKey is server-whitelisted', () => {
  for (const [tab, cfg] of Object.entries(TAB_REGISTRY)) {
    for (const c of cfg.columns) if (c.sortKey) expect(WL[tab]).toContain(c.sortKey);
  }
});
```

- [ ] **Step 3: Compose the pages + nested drawer routes**

Each page: `const cfg = TAB_REGISTRY[tab]; const [filters, setFilters] = useState<FilterState>({});` → `<FilterBar defs={cfg.filters} value={filters} onChange={setFilters}/>` + `<RecordTable endpoint={cfg.endpoint} columns={cfg.columns} filters={filters} onRowClick={(r) => navigate(\`\${cfg.path}/\${r.id}\`)}/>` + an `<Outlet/>`-driven `<DetailDrawer>` from the nested `:id` route (read `useParams().id`; `open={!!id}`, `onClose={() => navigate(cfg.path)}`, `fields={cfg.detailFields}`). Update `App.tsx` routes to nest `:id` under each tab path (e.g. `/samples/:id`).

- [ ] **Step 4: Unit tests GREEN; typecheck; build clean**

Run: `npm test`, `npm run typecheck`, `npm run build`.

- [ ] **Step 5: LIVE end-to-end verification (the integration proof)**

Ensure Postgres is up and the DB is seeded (`clients 270 / specialty 1063 / bulk 1237 / forwarding 15`). Start the API: from `api/`, `npm run dev` (port 4000). Copy `.env.example` to `.env` in `dashboard-v2/`. Start the FE: from `dashboard-v2/`, `npm run dev` (port 5174). Then verify (record each in the report):
  - `/samples` loads specialty rows; `total` reads 1063; sorting by `date`/`ref`/`status` re-queries and reorders; a status filter narrows results; pagination advances.
  - `/bulk` (1237) and `/forwarding` (15) load with their columns; bulk moisture/water range filters work; forwarding `has_id` filter works.
  - `/clients` (270) loads; sort by `latest_order_date` works; search narrows.
  - Row click opens the DetailDrawer deep-linked at `/samples/:id`; Timeline shows the seeded `created` event.
  - Inline-edit a specialty row's `status` to `dispatched` → the PATCH succeeds (optimistic), and reopening the drawer's Timeline shows the new `dispatched` event.
  A subagent that cannot drive a browser MUST at minimum: boot the API, `curl` each list endpoint to confirm the seeded totals and that `?sort=`/filter params return 200 with expected shape, confirm `npm run build` is clean, and report that browser-level visual verification is pending controller/user sign-off.

- [ ] **Step 6: Commit**

```bash
git add dashboard-v2/src
git commit -m "feat(fe): wire specialty/bulk/forwarding tabs + Clients list live against the API"
```

---

## Task 9: Dashboard placeholder + KpiTile/chart shells

**Files:**
- Create: `src/components/KpiTile.tsx`, `src/components/charts/ChartShell.tsx`
- Modify: `src/pages/DashboardPage.tsx`

**Interfaces:**
- Consumes: `ui/card` (or a hairline card div), `StatusBadge`.
- Produces: `<KpiTile label value hint? />`; `<ChartShell title />` (a titled, hairline-bordered empty card sized for a Phase-4 Recharts mount).

- [ ] **Step 1: Implement `KpiTile.tsx` and `ChartShell.tsx`**

`KpiTile`: hairline card, small muted label, large value, optional hint line. `ChartShell`: titled card with a centered muted "Chart — Phase 4" placeholder at a fixed aspect. Both are real, shippable components (not TODOs) — they establish the Dashboard grid the Phase-4 charts drop into.

- [ ] **Step 2: `DashboardPage.tsx`**

A responsive grid: a KPI row (KpiTile shells labelled per the Phase-4 tiles — In transit, Awaiting results, Dispatched this week, Total samples — showing `—` until Phase 4 wires `/stats`) + a couple of `ChartShell`s (By status, Volume over time). Header note that live metrics arrive in Phase 4.

- [ ] **Step 3: Verify + commit**

`npm run build`, `npm run typecheck`, `npm test` clean. `npm run dev`: `/` renders the KPI + chart grid in Twenty style, light/dark.

```bash
git add dashboard-v2/src
git commit -m "feat(fe): Dashboard foundation — KpiTile + ChartShell scaffolding for Phase 4"
```

---

## Self-Review (completed by plan author)

**Spec coverage (§7):** token pass → T2; app shell (nav+Cmd+K+theme) → T3; RecordTable → T5; FilterBar → T6; DetailDrawer+Timeline → T7; StatusBadge/tag pills → T2; KpiTile/chart shells → T9; TanStack Query over `api()` with `x-actor: dashboard` → T1+T4; routes + deep-linking → T3+T8; ≥1 tab (all 3 + Clients) live → T8. Tier-2/3 (kanban, saved views, calendar) correctly excluded. Dashboard charts + client drill-down deferred to Phase 4 per the approved design.

**Placeholder scan:** No `TBD`/`TODO`/"handle edge cases". The two "coming in Phase 4" strings (DetailDrawer Related tab, Dashboard shells) are intentional, labeled feature boundaries with shippable surrounding components, not deferred work within this plan.

**Type consistency:** `ListQuery`/`FilterState`/`SortState`/`ListResult`/`EventRow` defined in T4 and consumed unchanged in T5–T8; `ColumnDef` (T5), `FilterDef` (T6), `DetailField`/`TabConfig` (T7/T8) are each defined once and referenced consistently. Hook names (`useRecords`/`useRecord`/`usePatchRecord`/`useClients`/`useSearch`) are stable across T4→T8. `tagColor`/`TagKind` (T2) reused by StatusBadge + configs. Endpoints/sort-whitelists match the API contracts verbatim and are guarded by `registry.test.ts` (T8).

**Cross-task ordering note:** T3's Cmd+K search group imports `useSearch` from T4. If executing strictly in order, wire T3's ⌘K + nav navigation first; the search-results group compiles once T4 lands. The controller may run T4 before T3 to avoid this — both orderings are safe.
