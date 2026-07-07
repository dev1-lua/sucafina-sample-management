# Sucafina Sample Management Agent

A working prototype for coffee-sample tracking: a **CRM dashboard** and an **AI chat
agent** ("Kenyacof Sample Desk") over one Postgres database, seeded with real data from
the *Sample Chaser 2025–2026* workbook (~2,300 samples, ~270 clients).

Traders request samples → QC ships them → clients cup and give verdicts. This keeps one
accurate record per sample across that lifecycle, drivable by clicking (dashboard) or
typing in plain English (agent), and chases what's falling behind.

## Repository

| Path | What it is |
|---|---|
| `api/` | Sample API + Postgres schema/migrations (Express, TypeScript ESM) |
| `scripts/` | Seeder that loads the Excel workbook into Postgres |
| `dashboard/` | CRM web app (Vite + React) |
| `src/` | The Lua agent (persona, skills, tools, daily chaser job) |
| `docs/` | Source workbook + design/spec/plan docs |

## Docs

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — how the whole system works: data model, API,
  agent, dashboard, wiring, decisions, and the build history.
- **[DEMO.md](./DEMO.md)** — boot order, agent/tunnel wiring, and the 5-minute demo script.

## Quick start

```bash
docker compose up -d postgres             # Postgres on :5433
cd api && npm run migrate && npm run dev   # API on :4000
cd scripts && npm run seed                 # load the workbook (~2,300 samples)
cd dashboard && npm run dev                # dashboard on :5173
```

Then open **http://localhost:5173**. To connect the cloud agent to your local API (for
the chat widget), see the tunnel + `lua env` steps in [DEMO.md](./DEMO.md).

## Notes

- `api/`, `scripts/`, `dashboard/` are independent packages (not a workspace).
- Courier tracking is simulated; the agent logs and reports (it doesn't price or approve).
- Reset demo data to pristine any time: `cd scripts && npm run seed`.
