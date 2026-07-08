# Teams Bot Inbound — Diagnostic Findings (2026-07-08)

> Investigation of why the "Lua Teams Ops Assistant" 1:1 chat does not reply, and proof of what
> *does* work. Companion to `docs/teams-bot-setup.md` (runbook) and `MICROSOFT-CAPABILITIES.md`.

## TL;DR

- ✅ **The agent + deep-link feature work end-to-end** (proven on production — see §Proof).
- ✅ Unified `microsoftteambot` connection is **Active**; the `messaging_message.created` trigger is **healthy**.
- ❌ **Inbound Teams DMs never reach the agent.** Across **4** test DMs, webhook deliveries = **0** and there
  is **no `teams` event** in the agent logs — even after the trigger was healed AND the latest code was deployed.
- 🎯 **Root cause is upstream of anything in this repo / the Lua agent config:** the shared Lua demo bot
  (`3f6cd028…`) is not forwarding DMs into Unified. This is the Azure Bot / Bot-Framework layer, owned by the
  Lua platform. **Escalate to Rares / Lawrence** (§Escalation) — it's the exact open item the handover flagged.

## What was set up (all verified working on our side)

1. `lua integrations connect --integration microsoftteamsbot --auth-method oauth --scopes all --triggers messaging_message.created`
   → **Connection Active**, id `6a4e52af2daf5368226b3272`, MCP server active.
2. Trigger `messaging_message.created` created (id `6a4e52b02d12ef0642fc8c56`). It came up **🔴 unhealthy** (the
   subscription didn't establish on creation); `lua integrations webhooks resume --webhook-id …` re-subscribed it →
   **✅ healthy**.
3. Deep-link code deployed to production: `lua push all --force` → `lua deploy all --force` → `version create` →
   `version promote v3`.

## The evidence (definitive)

Four DMs were sent to "Lua Teams Ops Assistant" (`hi…` 12:09; `add a Type sample…` 19:12; again 19:20; again after
deploy). After each, checked:

| Check | Result |
|---|---|
| `lua integrations list` | `microsoftteambot` **Active** |
| `lua integrations webhooks list` | trigger **✅ healthy** (after resume) |
| `lua logs --type webhook` | **0 total deliveries** (before *and* after the trigger was healed and the code deployed) |
| `lua logs --type all` | newest entry unchanged at 11:21 AM (`dev`); **no `teams` event; no agent invocation from any DM** |

**Interpretation:** a healthy trigger only means *Unified's* side is subscribed. The message flow for a Teams
BOT is `Teams → Azure Bot Service → the bot's Messaging Endpoint URL`. Zero deliveries means the Azure Bot is
**not POSTing the DMs to Unified's ingestion** for this connection — so no `messaging_message.created` event is
ever emitted, and the agent is never woken. The deploy is irrelevant to this (it only changes the agent's *reply*,
not whether a message *arrives*).

This matches `MICROSOFT-CAPABILITIES.md` §6 (the bot connection *reads* via Graph ✅ but real-time **push was never
confirmed**; setup "paused on the flaky dev.teams.microsoft.com") and `TEAMS-AGENT-HANDOVER.md` §4's explicit open
item: *"whether DMs to the bot arrive as real-time webhook events."* Answer, with evidence: **not currently.**

## Proof the code works (production, channel-agnostic)

`lua chat -e production -m "Log this to the Bulk book now … quality AB FAQ, Type, client Beyers, Netherlands, 300g. Then reply with the dashboard link."`

```
Logged — AB FAQ • 300g • Beyers • Netherlands • Type, status: requested.
https://sucafina-sample-management.vercel.app/bulk/94a89c8a-d6b7-47ec-bb7a-1e54fb2af047?hl=created
```

The reply ends with the bare deep-link (`?hl=created`); opening it lands on the new Beyers record with the
"✨ Just created" banner + row-flash. **The whole feature works — it just needs a working inbound Teams channel.**

## Escalation — for Rares / Lawrence (Lua platform)

The blocker is the **Azure Bot registration `3f6cd028-8da5-4f8e-b7e7-d777a2c6b128`** (the shared Lua demo bot,
in Unified workspace `6970a2313ff596e474689ec7`). Please check / confirm:

1. **Messaging endpoint** — is the Azure Bot's *Messaging endpoint URL* set to Unified's bot ingestion, so DMs are
   forwarded to Unified (and thence to the `messaging_message.created` trigger)? If it's unset / pointing elsewhere,
   that fully explains 0 deliveries.
2. **Teams channel on the bot** — is the *Microsoft Teams* channel added/enabled on the Azure Bot? (Path B step 2 in
   `MICROSOFT-CAPABILITIES.md`; the doc notes this bot's setup was paused.)
3. **Per-org routing** — can this *shared* bot route inbound DMs to *this org's* connection
   (`6a4e52af…` / agent `baseAgent_agent_1783420556773_cc6qh9f2y`), or does Sucafina need its **own** Azure Bot
   registration + Teams app (the "Sucafina-branded app")?

**Recommended fix:** if the shared bot can't be relied on for per-org inbound push, stand up a **dedicated Sucafina
Azure Bot** whose messaging endpoint points to Unified, update `Plugin-test/teams-app/manifest.json`'s `botId`,
re-package/install, and reconnect. Everything else (agent, tools, deep-link, trigger wiring) is already done and
will work the moment inbound delivers.

## Key IDs

| Thing | Value |
|---|---|
| Agent | `baseAgent_agent_1783420556773_cc6qh9f2y` (org `d9764ee0-5a19-4c0d-9407-a2e2e489a827`) |
| Unified connection | `6a4e52af2daf5368226b3272` (microsoftteambot, Active) |
| Trigger | `6a4e52b02d12ef0642fc8c56` (`messaging_message.created`, healthy) |
| Agent webhook | `https://api.heylua.ai/webhook/unifiedto/data` |
| Azure Bot (shared demo) | `3f6cd028-8da5-4f8e-b7e7-d777a2c6b128` |
| Unified workspace | `6970a2313ff596e474689ec7` |
| Deep-link proof record | `/bulk/94a89c8a-d6b7-47ec-bb7a-1e54fb2af047?hl=created` |

## Status

- **Works now:** agent, sample logging, deep-link reply, dashboard "just created/updated" landing — via any wired
  channel (proven on production + the LuaPop widget). Independent of Teams.
- **Blocked (not on us):** Teams inbound delivery — needs the Azure Bot messaging-endpoint / per-org routing fix
  above. Once inbound delivers, no further agent/repo work is required.
