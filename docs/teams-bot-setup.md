# Sucafina Sample-management-agent → Microsoft Teams (1:1 assistant) — Wiring Runbook

> Make the **"Lua Teams Ops Assistant"** Teams chat answer as the Sucafina **Sample-management-agent**:
> you DM it in natural language ("add a Type sample, AB FAQ 300g, to Beyers"), it logs the record into
> the Sucafina backend, and replies with a **dashboard deep-link** to the exact row.
>
> This is a **1:1 DM assistant surface** (like Copilot), NOT an ambient/@mention group bot. The
> `docs/Quality - Trade Teams Chat.docx` transcript only illustrates the *kind of tasks* the desk handles.
>
> **Integration reference:** `MICROSOFT-CAPABILITIES.md` (this doc merges its Path-B findings with the
> exact `lua` CLI commands verified live on this agent).

## Verified current state (live, 2026-07-08)

| Check | Result |
|---|---|
| `lua integrations list` | **0 integrations connected** ← the gap |
| `lua channels list` | 1 channel: `WEBCHAT` (the LuaPop widget) — **no Teams** |
| `lua integrations info microsoftteamsbot` | available · OAuth · `oauthConfigured: true` |
| Teams app package (`Plugin-test/teams-app/`) | ✅ `manifest.json` + `appPackage.zip` (bot id `3f6cd028…`, `personal` scope) |
| Azure Bot `3f6cd028-8da5-4f8e-b7e7-d777a2c6b128` | ✅ exists (shared Lua demo bot = `microsoftteamsbot`) |
| Deep-link feature (agent returns `url`; dashboard highlights record) | ✅ built in repo (channel-agnostic, testable now via the widget) |

`lua logs` shows **zero `teams` events** ever reaching this agent — inbound Teams messages are simply not
routed to it yet. Nothing about the agent's logic needs changing.

## Why the bot connector (`microsoftteamsbot`), not plain `microsoftteams`

`MICROSOFT-CAPABILITIES.md` recommends the plain `microsoftteams` OAuth connector for generic read+post.
But that connector is an **identity** (acts *as* a user in Graph) — it is **not an installable assistant you
chat with**. The screenshot's "Lua Teams Ops Assistant" DM surface requires the **Bot Framework app (Path B)**
= `microsoftteamsbot`. So we use the bot connector deliberately (handover §4's identity-vs-assistant distinction),
accepting its slightly fiddlier setup.

## Coordinates

| Thing | Value |
|---|---|
| Agent | `Sample-management-agent` · `baseAgent_agent_1783420556773_cc6qh9f2y` · org `d9764ee0-5a19-4c0d-9407-a2e2e489a827` |
| Bot / Azure Bot client id | `3f6cd028-8da5-4f8e-b7e7-d777a2c6b128` (`microsoftteamsbot`) |
| Inbound trigger | `messaging_message.created` (native) → `https://api.heylua.ai/webhook/unifiedto/data` |
| Backend API | `https://sucafina-api.luameet.in` |
| Dashboard | `https://sucafina-sample-management.vercel.app` |
| Unified guide | https://docs.unified.to/guides/how_to_set_up_a_microsoft_teams_bot_with_unified |

## ⚠️ Open escalation (Rares / Lawrence — Lua platform)

Bot `3f6cd028…` is the **shared Lua demo bot**. Confirm a single Teams bot app can route its inbound DMs to
**this org's** agent (`d9764ee0…`). `MICROSOFT-CAPABILITIES.md` §6 records that this bot connection *reads* ✅
but *posting* returned **400 "Channel not found"** in the test org because the app wasn't installed into a team —
for a **personal 1:1 chat** the personal install (already done, per the screenshot) should cover posting, but
**step 6 is the make-or-break verification.** If a shared bot can't fan out per-org, fall back to a
**Sucafina-branded app** (own Azure Bot + manifest) — a documented later step.

---

## Steps

### Prereqs (Path B — per `MICROSOFT-CAPABILITIES.md`, already satisfied)
- Azure Bot `3f6cd028…` registered ✅ · Teams channel on the bot ✅ · manifest with the bot id ✅
- App installed as a **personal/1:1 chat** ✅ (it's in your Teams as "Lua Teams Ops Assistant"). If missing,
  sideload `Plugin-test/teams-app/appPackage.zip` (Teams → Apps → Manage your apps → Upload a custom app).

### 1. Connect the bot integration (INTERACTIVE — you run this) 🔑
This opens a Microsoft OAuth login in your browser. Run it in this session with the `!` prefix:
```
! lua integrations connect --integration microsoftteamsbot --auth-method oauth --scopes all --triggers messaging_message.created
```
- Sign in with the Microsoft account that owns the Teams chat (**org account**, M365-licensed).
- **Admin consent**: the `.All` scopes (`ChannelMessage.Read.All`, `Files.Read.All`, `Sites.Read.All`) need
  tenant-admin approval (`MICROSOFT-CAPABILITIES.md` limitation #3). If you're not admin, have IT approve at
  `https://login.microsoftonline.com/<tenant>/adminconsent?client_id=3f6cd028-8da5-4f8e-b7e7-d777a2c6b128`,
  then re-run the connect. (The `--triggers messaging_message.created` flag wires inbound routing in the same step.)

### 2. Confirm the connection + trigger (I run this) ✅
```
lua integrations list
lua integrations info microsoftteamsbot --json
lua integrations webhooks list
```
Expect: the connection present, and a `messaging_message.created` trigger pointing at the agent webhook.
(If `--triggers` didn't take, create it: `lua integrations webhooks create --integration microsoftteamsbot --object messaging_message --event created`.)

### 3. Confirm/create the Teams channel (may be INTERACTIVE) 
```
lua channels list
```
If no Teams channel appears alongside `WEBCHAT`, create one via interactive `lua channels` (channel creation is
interactive-only) so the agent's replies post back through the bot.

### 4. Set `DASHBOARD_BASE_URL` so the deep-links resolve (I run this)
```
lua env sandbox    -k DASHBOARD_BASE_URL -v https://sucafina-sample-management.vercel.app
lua env production -k DASHBOARD_BASE_URL -v https://sucafina-sample-management.vercel.app
```
(Code also falls back to this exact domain if unset, so links work regardless; setting it is explicit + future-proof.)

### 5. Deploy the deep-link agent code to production (gated flow)
`lua push all --force` → `lua deploy all --force` → `lua version create -m "deep-links"` → `lua version promote <v>`
(never bare `lua deploy` — a hook blocks it; use single simple commands). Use `/lua-push` and `/lua-deploy`.

### 6. Verify the full loop (the make-or-break test)
1. **Inbound:** DM the assistant "hi" → `lua logs` shows a **`teams`-channel event** reaching the agent (today: none).
2. **Outbound + deep-link:** DM "add a Type sample, AB FAQ 300g, to Beyers Netherlands" → the assistant gathers
   any gap, confirms, writes the record (visible at `…/bulk`), and its reply **ends with a bare dashboard URL**
   that opens the record with a "✨ Just created" banner + row-flash.
   - If posting 400s ("Channel not found"), the app isn't correctly installed for this chat — see the escalation above.

---

## Notes
- **Prove it before Teams is wired.** The deep-link loop is channel-agnostic — demo "DM → logged → link →
  highlighted record" today via the **LuaPop web widget** (`VITE_LUA_AGENT_ID` already points here) or
  `lua chat -e sandbox` (after `lua push all --force`). Teams inherits it for free once step 1–3 land.
- **One connection per integration per agent** (`lua integrations` note = `MICROSOFT-CAPABILITIES.md` limitation #5).
- **A Sucafina-branded app** (own Azure Bot + manifest/icons) is the eventual production shape; the shared demo
  bot only proves the flow now.
