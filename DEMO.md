# Sucafina Sample Desk — Demo Runbook

A live coffee-sample tracking system: a CRM dashboard + an embedded AI agent
("Kenyacof Sample Desk"), backed by **real data** loaded from the actual
*Sample Chaser 2025–2026* workbook (~2,300 samples, ~270 clients, ~4,600 events).

---

## The architecture (say this once, up front)

```
Browser (dashboard @ :5173)
   ├─ CRM pages  ──────────────► Sample API (:4000) ──► Postgres (:5433, seeded)
   └─ Chat widget ─► Lua cloud agent ─► cloudflared tunnel ─► Sample API (:4000) ─► Postgres
```

- **Dashboard** = the "Sample Chaser spreadsheet, but live."
- **Chat widget** = the same system, driven in plain English (as the team already
  talks in Teams/WhatsApp).
- Both read/write the **same database**, so anything the agent does shows up on the
  dashboard on refresh, and vice-versa.

---

## Boot order

Already running for this session. From a cold machine:

1. `docker compose up -d postgres`                       # DB on :5433
2. `cd api && npm run migrate && npm run dev`             # API on :4000
3. `cd scripts && npm run seed`                           # loads the workbook (~2,300 samples)
4. `cd dashboard && npm run dev`                          # dashboard on :5173
5. `cloudflared tunnel --url http://localhost:4000`       # note the https URL it prints

### Agent env (whenever the tunnel URL changes)
The agent runs in Lua's cloud, so its tools reach your local API **through the tunnel**:
```bash
npx lua env production -k API_BASE_URL -v "<the-https-tunnel-url>"
npx lua env production -k API_KEY -v "dev-key-sucafina"
```
No redeploy needed — env is read at runtime.

### Widget whitelist (one-time)
Lua dashboard → your agent → **Settings → Chat widget → Allowed websites** → add
`http://localhost:5173`. (Our `dashboard/src/widget.ts` also passes
`environment: 'production'`, which bypasses this check — belt and suspenders.)

### Agent deploy (already done)
`npx lua push all --force` → `npx lua deploy all --force` → `lua version create` →
`lua version promote`. Do **not** run bare `lua deploy` from automation; promote is a
deliberate step.

---

## Demo script (≈5 minutes)

**Framing:** "Today, sample tracking lives in a spreadsheet plus a Teams thread.
Nobody knows what's late without scrolling. This makes the log answer for itself."

### 1. Open on the dashboard — Samples page
Point at the **KPI tiles**: overdue, in transit, awaiting results, dispatched this week.
> "This is the real backlog from your Sample Chaser workbook — 2,300 samples, live."
Scroll the table; use a filter (status / search).

### 2. Chat as a **trader** — create a request
Open the bubble (bottom-right) and type:
> `Send AB FAQ and Heavy Mbuni type samples to Thomas at Beyers, needed by Friday.`

Expect: the agent logs both, echoes the refs, and applies default quantities
(offer 200g, type 300g, PSS 1kg). If "Beyers" isn't in the client book it will ask
**one** short question — that's the persona working; answer "yes, log it for Thomas at
Beyers." Refresh the Samples page → the two new records appear (actor `agent:chat` in
the timeline).

### 3. Chat as **QC** — log a dispatch
> `Beyers samples went out today, DHL 9620551651`

Expect: both flip to **dispatched** with the AWB attached. Refresh → status changes on
the dashboard.

### 4. Chat — courier tracking
> `Where is DHL 9620551651?`

Expect: a tracking status + ETA. (Tracking is simulated in this prototype — say so if
asked; the number maps deterministically to a status.)

### 5. Chaser page → **Run now**
Click **Run now**. Three buckets appear, **PSS first** (pre-shipment samples are
highest-stakes):
- ⏰ Not yet dispatched (past due)
- 🚚 Dispatched, no delivery confirmation (>5 days)
- 📋 Delivered, awaiting results (>7 days)
> "This is the chase list that today lives in someone's head. It also runs itself on a
> schedule (weekday 6am, Nairobi) and can DM whoever owns it."

### 6. Chat — record a result
Pick any delivered sample's ref from the dashboard, then:
> `<REF> cupped 84, citrus driven, clean — approved`

Expect: result recorded, status → **results_in**, cupping notes saved verbatim.

### 7. Close on the tiles
Back to the Samples page. Refresh.
> "Every message updated the same log the traders and management see. One source of
> truth, no chasing."

---

## Troubleshooting

- **Widget shows "Welcome!" but never replies:** the localhost origin isn't whitelisted.
  Add `http://localhost:5173` under Allowed websites, and confirm `widget.ts` passes
  `environment: 'production'`. Hard-refresh (Cmd+Shift+R).
- **Agent replies but tool actions fail / "API error":** the tunnel died or moved.
  Restart `cloudflared`, then re-set `API_BASE_URL` to the new URL.
- **401 from the API:** `API_KEY` mismatch — the API default is `dev-key-sucafina`.
- **Empty dashboard / tiles:** seed didn't run, or the DB is on the wrong port (5433).
- **Reset the demo data to pristine:** re-run `cd scripts && npm run seed`.

---

## What to say it *is* vs *isn't*

- **Is:** a working prototype on real data — intake, dispatch logging, status/tracking,
  results capture, a client book, and an automated chaser, driven from chat or a CRM.
- **Isn't (yet):** live courier APIs (tracking is simulated), auth/SSO, and it doesn't
  negotiate prices or approve shipments — it logs and reports, and escalates the rest.
