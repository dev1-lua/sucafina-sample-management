# Phase 4 (FE features) + light UI — Design (features-first, time-boxed)

Brand: Sucafina sample-management rebuild. Branch `feature/sample-management-agent` (KEEP branch, no merge).
Authoritative parent spec: `docs/superpowers/specs/2026-07-08-sample-management-rebuild-design.md` (§4 data, §5 API, §7 FE/tokens, §11 acceptance).

## Sequencing (user decisions, 2026-07-08)
- **Features first, polish last** (choice C). This spec = Phase 4 features. A separate polish spec follows.
- Edit UX = **drawer-only** (tables display-only; kills the AWB inline-input bug).
- Create = **center modal dialog** per sample tab.
- Clients drill-down = **full deep-linkable show-page** with sections.
- Tier-2: **column show/hide** included now.
- Dashboard = **KPI row + ~6 charts** wired to `/stats`.
- Phase-3 whole-branch review + final review: **deferred to one final OPUS review at the end** (1-hour crunch; running it now = no client-visible progress).

## Shared facts
- API base via `api()` (`src/lib/api.ts`), headers `x-api-key` + `x-actor: dashboard` already set. Non-ok throws.
- Endpoints (NEVER legacy `/samples`): `/specialty-samples`, `/bulk-samples`, `/forwarding-samples`, `/clients`, `/traders`, `/stats`, `/search`.
- Route paths: `/samples` (specialty), `/bulk`, `/forwarding`, `/clients`, `/clients/:id`.
- Data hooks (already added to `src/lib/query.ts`): `useRecords`, `useRecord`, `usePatchRecord`, `useClients`, `useSearch`, **`useCreateRecord`**, **`useDeleteRecord`**, **`useStats`** (+`StatsResult`), **`useTraders`** (+`Trader`). Do NOT re-add these.
- `/stats` shape = `StatsResult`. `/clients/:id` returns client row + `contacts[]` + `account_owner`(`{id,name,role,email}`|null) + `orders[]`(`{tab,id,ref,title,status,courier_norm,awb,date_on,delivery_on,result_norm}`, ≤200 date-sorted) + `events[]`.
- No new npm deps: delete-confirm reuses `ui/dialog`; account-owner avatar = styled initials div; column show/hide = `ui/dropdown-menu` checkbox items. No toast lib — use optimistic update + dialog/drawer close as feedback; surface errors inline.
- Enums per tab: see the tab configs (`src/tabs/{specialty,bulk,forwarding}.tsx`). Forwarding has no result/moisture/delivery. Server issues `ref`/`sample_ref`.

## Tracks (file ownership — parallel, non-overlapping)
- **A — Tables+CRUD:** `RecordTable.tsx` (drop inline-edit branch; add TanStack column-visibility), `tabs/registry.ts` (+`createFields` on `TabConfig`; keep a re-export so imports don't break), `tabs/{specialty,bulk,forwarding}.tsx` (strip `edit` from columns; add `createFields`; curated default-visible columns), new `components/CreateRecordDialog.tsx`, `DetailDrawer.tsx` (+Delete action w/ dialog confirm), `components/ColumnMenu.tsx`. May edit `types.ts` for new field types.
- **B — Clients:** new `pages/ClientDetailPage.tsx`, `App.tsx` (`/clients/:id` → page not drawer), `pages/ClientsPage.tsx` (row-click → navigate `/clients/:id`; `+ New` client modal), client edit (assign `account_owner` via `useTraders`) + delete.
- **C — Dashboard:** `pages/DashboardPage.tsx`, `components/KpiTile.tsx`, `components/ChartShell.tsx`, new `components/charts/*` (Recharts). KPIs: total(Σby_tab), in_transit, awaiting_results, awaiting_results_aging, dispatched_this_week. Charts: by_status(bar), volume_over_time(line), by_tab(donut), by_sample_type(bar), by_courier(bar), by_country(h-bar top15). Light+dark, palette from `src/lib/tags.ts`.
- **D — Phase 5 Agent:** agent `src/` only. Three per-table create/update tools (hard-required schemas), table routing, warm persona rewrite, data-out repoint to new endpoints/tables, retire legacy intake. Ground in `docs/data-dictionary.md` + parent spec §6.

## Constraints (every FE track)
- Changes only under `dashboard-v2/`. Do NOT touch `dashboard/`, `api/`, `scripts/`, migrations. (Track D touches only agent `src/`.)
- Verification floor before done: from `dashboard-v2/` — `npm run build` + `npm run typecheck` + `npm test` all clean (warnings = failures).
- Server-driven lists keep per-tab `sort` whitelists. Design tokens (Inter, hairline borders, 4px grid, dark mode) remain.
- Stage only your track's explicit paths. Never `git add -A`.

## Acceptance
Working create/edit/delete in the UI for all 3 sample tabs; Clients show-page with account owner + cross-table orders + timeline; Dashboard with real KPIs + 6 charts; column show/hide; agent creates+reads records across all 3 tables via a warm flow. One OPUS whole-branch review at the very end.
