# Sucafina Teams — Setup Runbook

**Status:** supersedes the Unified-era `teams-bot-setup.md` / `teams-bot-findings.md`.
Lua now ships a native first-class Teams channel (`docs.heylua.ai/channels/teams.md`) — no Unified.to.

## The model (confirmed with Rares, 2026-07-10)

- **One agent binds to one tenant *per bot*, first-come.** To bind a different agent to the
  *same* bot you must remove the existing connection. (This is why Dev's connect link handed back
  "Rhea" — he was in the *shared Lua tenant*, already bound to Rares' agent. In a tenant with
  nothing bound yet, the connect link binds *your* agent cleanly. Not a data leak — a binding
  collision.)
- **Both connect paths still need the Teams app package uploaded to the tenant** — which needs a
  Teams admin if you're not one yourself. The difference is Azure work, not the upload.
- **Two connect options in the dashboard** (Agents → agent → + → Microsoft Teams):
  - **Use Lua's Teams bot** — one click, Lua hosts the Azure Bot, **no Azure setup**. Bind via a
    single-use 24h connect link.
  - **Bring your own Azure Bot** — your own Azure Bot Service registration; own identity/branding;
    needed to publish to your org's Teams catalog. **Lua generates the manifest for you** once you
    enter the App ID.
- **From Lua's side, BYO only needs the Messaging endpoint** you set in Azure:
  `https://wa.heylua.ai/teams/webhook`.
- **DM-only** = manifest `scopes: ["personal"]` (drop team/groupChat). Lua's generated manifest
  ships all three scopes; edit it down to `personal` if you want to suppress @mentions/channels
  (Sucafina requirement: 1:1 DM assistant — see the scope note below).
- **Outbound is warm-only.** The agent can only proactively message a user who has DM'd it at
  least once. No cold outreach, no time window. Reminder/chaser targets must open the DM first.

## Two phases

| Phase | Bot | Tenant | Purpose |
|---|---|---|---|
| **1 — Prove the path (us)** | **Lua's Teams bot** (one click, no Azure) | A tenant we control (Dev's own, nothing bound) | Prove the Sucafina agent replies in a Teams DM **and writes to the sample-management tables**. |
| **2 — Sucafina rollout** | **Sucafina's own Azure Bot**, branded | Sucafina's M365 tenant | Own identity, own catalog, clean isolation. Same agent underneath. |

---

## Phase 1 — Prove the path (Lua's Teams bot, no Azure)

1. `lua admin` (or admin.heylua.ai) → **Agents** → select the **Sucafina Sample-desk agent**
   (`baseAgent_agent_1783420556773_cc6qh9f2y`) → **+ → Microsoft Teams**.
2. Choose **Use Lua's Teams bot** (the top option — "no Azure setup required").
3. **Download the Teams app package** the dashboard hands you.
4. **Get the app uploaded to your tenant.** If you're not the Teams admin, send the package to your
   admin: *Teams → Apps → Manage your apps → Upload a custom app.* (This is the one approval both
   paths need.)
5. In the dashboard, **generate the Connect link** (single-use, expires in 24h — regenerable).
6. Open the link → it opens a DM with the bot, pre-filled → **send** the message → wait for the
   confirmation. This binds **your tenant → the Sucafina agent**.
7. **DM the bot** → it must reply **as the Sucafina Sample-desk assistant** (not Rhea/generic Lua).
8. **Prove the write path:** ask it to create a test sample → confirm the row appears on the
   dashboard (with the `?hl=` "just created" banner). ⚠️ This writes to the **real** backend the
   agent is wired to — use obviously-fake test data and clean up after.

✅ If the DM replies as the Sucafina persona and the row lands on the site, the path is proven.

---

## Phase 2 — Sucafina rollout (Bring Your Own Azure Bot)

Run by Sucafina's Azure + Teams admin in *their* tenant, for branding + isolation.

### Azure (Sucafina IT)
1. portal.azure.com → **Create a resource → Azure Bot** → type **Single-Tenant**, SKU **F0**.
2. **Configuration:** record **Microsoft App ID** + **App Tenant ID**; set **Messaging endpoint** =
   `https://wa.heylua.ai/teams/webhook` → **Apply**.
3. **Certificates & secrets** (via the "Manage" link) → **New client secret** → copy the **Value**.
4. **Channels → Microsoft Teams** → enable → accept terms.

### Lua dashboard (us / Sucafina)
5. Agents → Sucafina agent → **+ → Microsoft Teams → Bring your own Azure Bot**.
6. Enter **Microsoft App ID**, **App Password** (client secret), **Tenant ID** → **Connect**.
7. **Download the manifest the dashboard generates.** (No hand-building needed.)
8. *(Optional, for DM-only)* edit the generated manifest's `bots[].scopes` down to `["personal"]`
   and re-zip — see template below. This is how we suppress @mentions/group channels.
9. Rebrand the manifest (`name`, `developer`, icons) to Sucafina, then have their admin upload it
   via **Teams → Apps → Manage your apps → Upload a custom app**.
10. Users DM the bot → replies as the Sucafina assistant, isolated in Sucafina's tenant.

### What Sucafina's admin needs from us
- This runbook. The Messaging endpoint: `https://wa.heylua.ai/teams/webhook`.
- Note: reminders are **warm-only** — each user must DM the bot once before automation can reach them.

---

## DM-only scope edit (optional)

To pin the bot to 1:1 DMs (no @mentions/channels), edit the dashboard-generated manifest so the
bot entry reads:

```json
"bots": [
  {
    "botId": "<APP_ID>",
    "scopes": ["personal"],
    "supportsFiles": false,
    "isNotificationOnly": false
  }
]
```

Dropping `team`/`groupChat` means the app can't be added to channels/group chats → no @mention
surface. Matches the Sucafina 1:1-DM requirement.

## Open items with Lua (Rares)
- **Server-side channel-suppression** — Rares thinks the manifest `personal` scope covers it;
  he's confirming whether anything else is needed on Lua's side.
- **OAuth to replace the connect-link hack** — planned; **not needed for BYO** (BYO uses App
  ID/secret, not the connect link). Only relevant if we ship the Lua's-bot path to a client.

## Note on the old repo manifest
`Plugin-test/teams-app/manifest.json` is the **shared demo bot** (`botId 3f6cd028…`,
`validDomains: api.unified.to`). Do not ship it.
