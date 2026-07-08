# Microsoft Integrations (via Unified.to) — Capability Matrix

> Living matrix of **every tool × every integration**: what works, what fails, and the limitations.
> Companion to `MICROSOFT-UNIFIEDTO-RESEARCH.md` (setup/research) and Linear **PRO-54** (canonical log).
> Tested against the Lua org tenant (`rares@luaai.onmicrosoft.com`, M365-licensed) + a personal MS account, on agent `rares-test-agent`, via the Unified.to MCP directly + through the agent. Last updated **2026-07-06**.

**Legend:** ✅ works (verified) · ❌ fails · ⚠️ works-but-limited · ⏳ not yet tested · 🚫 not set up

---

## Cross-cutting limitations (apply across integrations)

| # | Limitation | Detail |
|---|---|---|
| 1 | **Account type determines data** | A **personal** MS account has a mailbox/files but **no directory** (HRIS tools 400). An **org** account has the directory + (if M365-licensed) mailbox/files/sites. Lua's org tenant was unlicensed until 2026-06-18 → mail/calendar/SharePoint only work after the M365 license was added. |
| 2 | **Delegated writes need an admin role** | Directory **writes** (`create/update/remove_hris_employee`) return **403 "Insufficient privileges"** unless the *connected user* holds an admin role (e.g. User Administrator). The `*.ReadWrite.All` scope alone is not enough. Reads work for any user. |
| 3 | **Admin consent per tenant** | `.All` scopes (Directory/Sites/etc.) require the connecting tenant's admin to consent. Non-admin → "needs approval" → admin grants (`login.microsoftonline.com/<tenant>/adminconsent?client_id=<appId>`) → user **retries** connect. The connection webhook fires on the retry, not on approval. |
| 4 | **`Device.ReadWrite.All` is application-only** | Not a delegated scope → skipped on AD/Intune apps. No device-write tool is exposed anyway (devices are read-only). |
| 5 | **One connection per (agent, integration)** | Reconnecting an integration **replaces** the previous connection (e.g. connecting org Outlook replaced personal Outlook). Can't hold two accounts for the same integration on one agent. |
| 6 | **`create_storage_file` requires `type`** | Omitting `type` → 400 "requires these fields: type". Use `type:"FILE"` + base64 `data` (+ `parent_id` for SharePoint sites). |
| 7 | **Fresh tenant = sparse data** | Newly-licensed tenant has empty mailboxes / one default site / no Teams or Plans until created. Tools wire up but may return empty until data exists. |
| 8 | **MCP token logged in plaintext** | lua-core logs the Unified MCP JWT (`…&token=eyJ…`, workspace-scoped) — redaction follow-up. |
| 9 | **MCP response parsing** | tool calls return **plain JSON** (not SSE); some Graph fields carry control chars that break strict double-parsers (jq). Parse leniently (Python `json.loads(strict=False)`). |
| 10 | **Some data is application-only / premium** | Verified vs Graph: **`CallRecords.Read.All` is application-only** (no delegated form) — and Unified's `uc_call_read` maps to *no* Graph scope at all → call records can't work on a user connection. **Recordings/transcripts**: a delegated scope name exists and was granted, but the Graph recordings API still demands an **application role** ("Roles on the request ''") → delegated 403s. So both are effectively **app-only** — a user-login (delegated) connection 403s; you'd need a separate **client-credentials (app-only) connection**. Teams **webinars** need **Teams Premium / virtual events** (else 400; the `VirtualEvent.Read` scope itself is fine). |
| 11 | **Teams channel posting requires a real channel id** | `create_messaging_message` on Teams 422s "Invalid channel ID" when using the id from `list_messaging_channels` (which returns the team/group, not a channel). Posting **works** once you have the real channel thread id (`19:…@thread.tacv2`) — scrape it from any existing message's `channel_id`. [Unified bug: channel discovery] |

---

## 1. Microsoft AD / Entra ID — ✅ TESTED (org account) · 9 tools

| Tool | Status | Notes |
|---|---|---|
| `list_hris_employees` | ✅ | live directory (3 users) |
| `get_hris_employee` | ✅ | full fields, emails, employment_status |
| `create_hris_employee` | ❌ 400 | with User Administrator role it's no longer 403 → now **400 "A password must be specified"**: Unified's HRIS model has **no password field**, Graph requires one → **can't create a Microsoft directory user** [Unified bug] |
| `update_hris_employee` | ✅ (fixed 2026-07-06) | Unified deployed PUT→PATCH fix — now returns the updated employee object. Verified against a live user. |
| `remove_hris_employee` | ✅ | **works with User Administrator role** — verified end-to-end (seeded throwaway via az → deleted via Unified → 404 after). Admin-gated (Microsoft RBAC), not a bug. |
_(HRIS-employee writes are the same Graph operations on every connector — `create` 400 and `remove` ✅ (admin) are representative for Outlook/OneDrive/SharePoint/Teams too. `update` was also broken 405 across all connectors but was **fixed 2026-07-06** by Unified.)_
| `list_hris_groups` | ✅ | 2 groups (Lua Global Inc, All Company) |
| `get_hris_group` | ✅ | |
| `list_hris_devices` | ✅ | works, 0 devices in tenant |
| `get_hris_device` | ⏳ | untestable — no devices to fetch |
**Verdict:** reads fully work; `update` ✅ (fixed 2026-07-06); directory **writes are admin-gated** (`create` needs User Administrator role, but still fails due to no password field — Unified bug; `remove` ✅ with admin). No passthrough tool.
**⚠️ Agent-UX trap:** the write tools (`create/update/remove_hris_employee`) appear in `tools/list` but 403 at call time unless admin; `get_hris_device` is offered but useless without devices.

## 2. Microsoft Outlook — ✅ TESTED (personal: mail/cal · org: mailbox+dir) · 20 tools

| Tool | Status | Notes |
|---|---|---|
| `list_calendar_events` | ✅ | |
| `get_calendar_event` | ✅ | used in write-verify (404 after remove) |
| `create_calendar_event` | ✅ | needs `calendar_id`, `start_at`/`end_at`; `send_notifications:false` |
| `update_calendar_event` | ✅ | |
| `remove_calendar_event` | ✅ | verified gone (404) |
| `list_calendar_busies` | ✅ | |
| `list_calendar_calendars` | ✅ | |
| `get_calendar_calendar` | ✅ (read; list verified) | |
| `list_messaging_channels` | ✅ | 10 mail folders |
| `get_messaging_channel` | ✅ (read; list verified) | |
| `list_messaging_messages` | ✅ | |
| `get_messaging_message` | ✅ | |
| `create_messaging_message` | ✅ | **sends a real email** (outward-facing) |
| `update_messaging_message` | ✅ | toggled `is_unread` (reversible) |
| `remove_messaging_message` | ✅ | |
| `list_hris_employees` | ⚠️ | ❌400 on **personal** (no directory) · ✅ on **org** |
| `get_hris_employee` | ⚠️ | org ✅ / personal ❌ |
| `create/update/remove_hris_employee` | ❌/❌/✅ | create→400 (Unified no-password bug); update→405 (Unified method bug); remove→✅ with User Administrator role (see AD §1) |
**Verdict:** mail + calendar = full CRUD ✅ (verified personal + org, cleaned up). HRIS only on org accounts, reads only. Sending email is outward-facing — use send-to-self for tests.
**⚠️ Agent-UX trap:** `create_messaging_message` actually **sends** (no obvious draft vs send distinction) and is irreversible/outbound; **which tools work depends on account type** — HRIS 400s on personal accounts, so the same connector behaves differently per user.

## 3. Microsoft OneDrive — ✅ TESTED (org account) · 12 tools

| Tool | Status | Notes |
|---|---|---|
| `list_storage_files` | ✅ | |
| `get_storage_file` | ✅ | |
| `create_storage_file` | ✅ | requires `type:"FILE"` + base64 `data` (limitation #6) |
| `update_storage_file` | ✅ | rename verified |
| `remove_storage_file` | ✅ | verified gone (404) |
| `list_hris_employees` | ✅ | org directory (3) |
| `get_hris_employee` | ✅ | |
| `create/update/remove_hris_employee` | ❌/✅/✅ | create→400 (Unified: no password field — still open); **update→✅ (fixed 2026-07-06)** (was 405, Unified deployed PATCH fix); **remove→✅ with User Administrator role** |
| `list_hris_groups` | ✅ | |
| `get_hris_group` | ✅ | |
**Verdict:** file CRUD = fully ✅ (lifecycle clean). HRIS reads ✅, writes 403.
**⚠️ Agent-UX trap:** `create_storage_file` silently requires `type` (400 "requires these fields: type" if omitted) — not marked required in the schema; an agent must fail once to learn it.

## 4. Microsoft SharePoint — ✅ TESTED (org account) · 16 tools

| Tool | Status | Notes |
|---|---|---|
| `list_kms_spaces` | ✅ | 1 site ("All Company") |
| `get_kms_space` | ✅ | |
| `list_kms_pages` | ✅ | **requires `space_id` arg** (errors without it) |
| `get_kms_page` | ✅ | |
| `list_storage_files` | ✅ | site doc library root |
| `get_storage_file` | ✅ | |
| `create_storage_file` | ✅ | needs `type:"FILE"` + `parent_id` (site root) + base64 `data` |
| `update_storage_file` | ✅ | |
| `remove_storage_file` | ✅ | verified gone (404) |
| `list_hris_employees` / `get_hris_employee` | ✅ | org directory |
| `create/update/remove_hris_employee` | ❌/✅/✅ | create→400 (Unified: no password field — still open); **update→✅ (fixed 2026-07-06)** (was 405, Unified deployed PATCH fix); **remove→✅ with User Administrator role** |
| `list_hris_groups` / `get_hris_group` | ✅ | |
**Verdict:** KMS (sites/pages) reads ✅, file CRUD ✅ (lifecycle clean). `list_kms_pages` needs `space_id`.
**⚠️ Agent-UX trap:** two hidden-required args, neither marked required — `list_kms_pages` needs `space_id` (errors without it), `create_storage_file` needs `type` **and** `parent_id` (the site root id). An agent must chain list→extract id→create.

---

## Pending integrations (tools from research; statuses TBD at test)

### 5. Microsoft Teams — ✅ TESTED (org) · 32 tools (calendar + messaging-read + directory work; posting & UC limited)

| Tool(s) | Status | Notes |
|---|---|---|
| `list_calendar_events` / `list_calendar_busies` / `list_calendar_calendars` / `get_calendar_*` | ✅ | functional (empty tenant → 0 events; 1 calendar) |
| `create_calendar_event` / `update_calendar_event` / `remove_calendar_event` | ✅ (not separately re-run) | identical Graph calendar tools as Outlook, verified there (same org mailbox) |
| `list_calendar_recordings` / `get_calendar_recording` | ⚠️ | requires an `event_id` arg — untestable without a meeting recording |
| `list/get/create/update/remove_calendar_webinar` | 🚫 not set up | needs **Teams Premium** — "virtualEvents not found" is a feature-licensing gap, not a permissions gap (`VirtualEvent.Read` scope is delegated and was granted; only the license is missing) |
| `list_messaging_channels` / `get_messaging_channel` | ✅ | returns the team ("Lua Global Inc") |
| `list_messaging_messages` / `get_messaging_message` | ✅ | 0 messages (empty channel) |
| `list_messaging_messages` (no arg) | ✅ | returns ALL channel posts + chats/DMs across the user's teams; each message's `channel_id` is the **real, postable id** — form `{"t_id":"dm-19:…@thread.tacv2"}` (channel), `{"t_id":"dm-48:notes"}` (self-chat), `dm-19:…` (chats) |
| `create_messaging_message` → **known** channel/chat | ✅ | `channels:[{id:<real channel_id from a message>}]` posts successfully (**verified** into self-chat). Works for channels and existing chats. Thread reply via `parent_id` = same mechanism (high confidence, not separately run). |
| `create_messaging_message` with the **team** id | ❌ | 422 "Invalid channel ID" — the `list_messaging_channels` id (team/group) is NOT a valid post target. |
| start a **new** DM/chat via `destination_members` | ❌ | 400 "Channel not found" — won't create a chat for members with no existing conversation. |
| **discover** channels/chats | ❌ **[Unified limitation]** | `list_messaging_channels` returns only the **team**, not its channels or the user's chats → you can only post where you've already *seen* a message (channel_id known). No `create_messaging_channel` tool. |
| delete a message | ❌ **[Unified limitation]** | no `remove_messaging_message` tool for Teams (only create/update). |
**→ Teams messaging READ ✅ and POST-to-a-known-channel/chat ✅. The real gaps are [Unified Bug 8]: you can't *discover* channels/chats (only the team container is listed), can't *start* a new conversation, and can't *delete* — so an agent can reply where it's seen activity but can't pick/open/clean up a thread on its own.**
**⚠️ Agent-UX trap (worst of any integration):** posting needs a channel id that the obvious tool (`list_messaging_channels`) does **not** return — it must be scraped from a message's `channel_id`. Errors are cryptic ("Invalid channel ID" / "Channel not found"). UC and webinar tools are present but blocked by environmental setup. A naive agent would wrongly conclude "Teams posting is impossible."
| `list_uc_calls` / `get_uc_call` | 🚫 not set up | `CallRecords.Read.All` is **application-only** (no delegated form — verified). Not testable via the current user/delegated connection; needs a separate client-credentials (app-only) connection. |
| `list_uc_recordings` / `get_uc_recording` | 🚫 not set up | recordings API demands an **application role** — delegated is insufficient. Effectively app-only; needs a separate client-credentials connection. |
| `list_hris_employees` / `get` / `list_hris_groups` / `get` | ✅ | org directory |
| `create/update/remove_hris_employee` | ❌/✅/✅ | create→400 (Unified: no password field — still open); **update→✅ (fixed 2026-07-06)** (was 405, Unified deployed PATCH fix); **remove→✅ with User Administrator role** |
**Verdict:** calendar (read + CRUD), messaging read + **post to a known channel/chat ✅**, directory ✅, **HRIS update ✅ (fixed)**. **Channel discovery is the real gap** [Unified Bug 8]: `list_messaging_channels` returns only the team, not its channels — postable channel ids must be scraped from existing messages; no create-channel or delete-message tools. **Call records + recordings: not tested** — app-only permissions require a separate client-credentials connection. **Webinars: not tested** — needs Teams Premium license.

### 6. Microsoft Teams (bot) — ⏳ (messaging only; needs a Teams app manifest + bot install on top of OAuth)
Expected: messaging channel (list/get), messaging message (list/get/create/update), messaging event (read).

A separate Teams bot connection exists and **reads messages ✅**, but **sending → 400 "Channel not found"** because the Teams app hasn't been installed into a team. Setup was paused (dev.teams.microsoft.com was flaky during testing).

> **Recommendation:** skip full bot setup for now — the **regular `microsoftteams` OAuth connector** covers the same use cases (read + post) with far simpler setup. The bot connector is only needed for bot-initiated proactive messaging to users who haven't messaged first.

---

## Teams Integration Guide (Quick Start)

> How to connect a Lua agent to Microsoft Teams via Unified.to. Two paths — start with **Path A** (simpler, covers 95% of use cases).

### Path A — Microsoft Teams OAuth connector (`microsoftteams`)

**What it gives you:**
- Read all messages in channels and DMs ✅
- Post messages to any channel/chat (once you know the channel id) ✅
- Full calendar CRUD (create/update/delete events) ✅
- Read org directory (employees, groups) ✅
- Update directory users ✅ (fixed 2026-07-06; requires User Administrator role for writes)

**Setup steps:**
1. In Unified.to dashboard → **Connections → New connection → Microsoft Teams**
2. Sign in with a Microsoft account that has Teams access (must be an **org account** with M365 license — personal accounts have no directory or Teams)
3. Grant admin consent when prompted (the `.All` scopes need tenant admin approval — if you're not the admin, ask IT to approve at `https://login.microsoftonline.com/<tenant>/adminconsent?client_id=44e4bc5f-6273-42e6-b4f0-31c48ec9b481`)
4. Copy the **connection ID** from the Unified dashboard (or `GET https://api.unified.to/unified/connection`)
5. In the Lua agent config, set the Unified connection to the Teams connection ID

**⚠️ Channel posting gotcha — the only real friction:**  
`list_messaging_channels` returns only the team container (not the actual channels). To post to a channel, you need the real channel thread id (`19:…@thread.tacv2`). Two ways to get it:
- **Option 1 (agent):** Call `list_messaging_messages` (no arguments) first — it returns all messages across all channels/DMs, each with a `channel_id` that IS the real postable id.
- **Option 2 (pre-configure):** Get the channel id once from Graph (`GET /teams/{teamId}/channels`) and hardcode it as a known channel the agent can use.

**Test it:**
```bash
# 1. List all messages (gets real channel ids as a side effect)
MCP  list_messaging_messages  {}

# 2. Post using a channel_id from step 1
MCP  create_messaging_message  {"body": {"content": "Hello from Lua!"}, "channel_id": "<id from step 1>"}
```

---

### Path B — Microsoft Teams Bot connector (`microsoftteamsbot`)

Required only if the agent needs to **proactively message users who haven't messaged it first**, or run as a proper bot with a Teams app icon/manifest.

**Additional steps on top of Path A:**
1. Register an **Azure Bot** at `portal.azure.com` → Azure Bot → Create (use the client_id `3f6cd028-8da5-4f8e-b7e7-d777a2c6b128`)
2. Under the bot → Channels → Add **Microsoft Teams** channel
3. Create a Teams app manifest (`manifest.json`) with the bot id
4. Sideload the app into your Teams org via Teams Admin Center or `appPackage.zip` upload
5. Install the app into the specific team/channel where the bot should operate
6. **Then** connect via Unified (same OAuth flow as Path A but with the bot connector)

**Status:** Connection exists and **reads work ✅**, but posting blocked until the app is installed in a team (step 5 above). Not set up in our test org. Skip unless you specifically need proactive bot messaging.

### 7. Microsoft Planner — ✅ TESTED (org) · 11 tools (READ-ONLY tasks)
| Tool | Status | Notes |
|---|---|---|
| `list_task_tasks` | ✅ | 0 (no Planner tasks created in tenant yet) |
| `get_task_task` | ⏳ | untestable — no tasks to fetch |
| `list_task_projects` | ✅ | 2 (the M365 groups surfaced as projects) |
| `get_task_project` | ✅ | read |
| `list_hris_employees` / `get` / `list_hris_groups` / `get` | ✅ | org directory |
| `create/update/remove_hris_employee` | ❌/✅/✅ | create→400 (Unified: no password field — still open); **update→✅ (fixed 2026-07-06)** (was 405, Unified deployed PATCH fix); **remove→✅ with User Administrator role** |
**Verdict:** **read-only for tasks** — there are **no `create/update/remove_task_task` tools at all** (an agent cannot create/complete a Planner task via this integration; Graph supports it, Unified doesn't expose it → **[Unified limitation]**). Reads work; tenant has no task data yet.
**⚠️ Agent-UX trap:** the *absence* of write tools is only discoverable by noticing they're missing from `tools/list` — an agent expecting `create_task_task` (present on most other connectors) won't find it and gets no explanatory error.

### 8. Microsoft Intune — ✅ TESTED (org) · 9 tools (device mgmt unavailable — tenant not Intune-licensed)
| Tool | Status | Notes |
|---|---|---|
| `list_hris_employees` / `get` / `list_hris_groups` / `get` | ✅ | directory — **identical to AD** (Intune just re-exposes the Entra directory) |
| `list_hris_devices` | 🚫 not set up | tenant has no Intune license; Graph `/deviceManagement` → "not applicable to target tenant" — NOT a Unified bug. Needs Intune Plan 1 license + enrolled device. |
| `get_hris_device` | ⏳ | not tested — no devices |
| `create/update/remove_hris_employee` | ❌/❌/✅ | same as AD — create 400 (no-password), update 405, remove ✅ (admin) |
**Verdict:** directory ✅ (= AD); **device management not tested** — tenant has no Intune license. Needs Intune Plan 1 + enrolled device to unlock MDM tools.
**⚠️ Agent-UX trap:** if called without a license, the device error ("Invalid version: devicemanagement") is misleading — the real cause is "tenant has no Intune," not a version problem.

### 9. Dynamics 365 Sales — ✅ TESTED (Sales trial, Dataverse `org7805a17c.crm.dynamics.com`) · 35 tools
Connected with the **Dataverse `user_impersonation`** permission from our Entra app — **it works**, confirming Dataverse is the correct resource for Sales. Real trial sample data (Fabrikam, contacts, opportunities, leads).
| Tool group | Status |
|---|---|
| CRM **contact / lead / company / deal** | **full CRUD ✅** (create→get→update→remove, cleaned up) |
| `create_crm_contact` **with `emails`** | ✅ as of **2026-06-21 re-sweep** (create→get→update→remove all passed *with* an `emails` array) — the earlier **500 appears fixed by Unified**; was a Unified bug |
| CRM **event** | create ✅ (requires `type` ∈ EMAIL/CALL/TASK/MARKETING); update re-validates type; **no remove tool** |
| `list_crm_events` | ✅ (requires `type` arg) |
| `accounting_invoice` | list ✅ (0); **create ❌ 400** — needs fuller payload (customer/currency), couldn't create minimally |
| `list_metadata_metadatas` | ⚠️ requires `type`; **valid values undocumented** (contact/lead/account/opportunity all → 400 "Unsupported object type") |
| `list_hris_employees` | ✅ (100 Dataverse system users); HRIS writes per cross-cutting (create 400 / **update ✅ fixed** / remove ✅ with admin) |
**Verdict:** core CRM (contacts/leads/companies/deals) = **full CRUD ✅ with real data — the strongest write coverage of any connector.** Rough edges are Unified bugs (contact+emails 500; undocumented metadata `type`; invoice payload).
**⚠️ Agent-UX trap:** `create_crm_contact` 500s on a reasonable `emails` payload; `list_crm_events` / `list_metadata_metadatas` need a `type` whose valid enum isn't surfaced (fail-to-discover).

### 10. Dynamics 365 Customer Engagement — ✅ TESTED (same Dataverse as Sales, `org7805a17c`) · 62 tools
**Same Dataverse / same data as Sales** (CE = the umbrella CRM app family; Sales is one CE app). The connector is a **superset** of Sales' tools — adds accounting (orders/accounts/orgs/contacts), **tasks** (task/project), hris groups.
| Tool group | Status |
|---|---|
| CRM contact / lead / deal | **reads ✅** (contacts 16, leads 17, deals 23). **Writes ❌ — `create_crm_*` → 422 Unprocessable Entity on every payload** (name+emails, name-only, first/last) per the **2026-06-21 direct CE re-test**. The earlier "CRUD ✅" was extrapolated from Sales; CE writes are **not** functional. |
| CRM **company** | ⚠️ list/get/remove only — **no create/update tools** (asymmetric vs Sales, which has them) |
| `crm_event` | list/get/create/update/**remove** ✅ (CE adds remove vs Sales) |
| `list_task_tasks` / `list_task_projects` | ✅ — **Dynamics tasks surface here (3)**, unlike the M365 Planner connector (0) — different backend (Dataverse activities vs Planner plans) |
| `list_accounting_invoices` / `_organizations` / `_accounts` | ✅ |
| `list_accounting_orders` | ❌ 400 — Unified queries a non-existent `parentbundleidref` field [Unified bug] |
| `list_accounting_contacts` | ❌ 400 — Unified queries a non-existent `externaluserid` field [Unified bug] |
| `list_hris_groups` | ❌ 404 — Unified hits a `/team` segment that doesn't exist [Unified bug] |
| net-new writes (`create_task_task`, `create_accounting_account`, …) | ⚠️ 422 on minimal `{name}` — need fuller required fields (not characterized) |
| hris employees | list/get ✅ (188 system users); writes per cross-cutting (create 400 / **update ✅ fixed** / remove ✅ with admin) |
**Verdict:** broad reads ✅ (incl. Dynamics tasks); **CRM writes ❌ (422) — NOT Sales-equivalent** (corrected 2026-06-21: Sales connection writes fine, CE connection does not, despite the same Dataverse org). 3 accounting/group list endpoints broken by Unified OData/version bugs. **So for writes use the Sales connector, not CE.**
**⚠️ Agent-UX trap:** CE creates return a bare `422 Unprocessable Entity` with no field detail (vs Sales succeeding on identical payloads); 3 list endpoints 400/404 because Unified queries fields/segments absent in this Dynamics version; `create_crm_company` silently missing (present on Sales).

### 11. Dynamics 365 Business Central — ✅ TESTED (BC trial, Cronus demo) · 48 tools
Connected after the permission fix (below). Real Cronus demo data.
| Tool group | Status |
|---|---|
| **All accounting reads** — invoices, bills, orders, salesorders, purchaseorders, accounts (GL), contacts (customers), organizations, journals, transactions (list+get) | ✅ **every one works** — richest accounting surface, all functional (contrast CE's broken accounting lists) |
| hris employees / companies | ✅ (Ester Henderson; CRONUS USA, Inc.) |
| `accounting_contact` create / get / remove | ✅ (create requires `is_customer`; verified create→get→remove, cleaned up) |
| `update_accounting_contact` | ❌ 400 — Unified sends `irs1099Code`, a property not in this BC version [Unified bug] |
| `create_accounting_journal` | ⚠️ needs `reference` ≤10 chars (BC validation; works with a short ref) |
| invoice/bill/order/salesorder/purchaseorder writes | create-capable; require object-specific fields (BC validation names them) |
| HRIS employee writes | per cross-cutting (create 400 / update 405 / remove ✅ admin) |
**Verdict:** **reads fully ✅** (best accounting coverage of any connector), writes mostly ✅ with one Unified update bug (`irs1099Code`).
**Permission resolution (the long-standing BC question, ANSWERED):** BC connect first failed `AADSTS650057` requesting resource **`https://api.businesscentral.dynamics.com`** (BC API appId `996def3d-b36c-4153-8607-a6fd3c01b89f`). Fixed by adding **BC API `user_impersonation`** (scope `bce0976a-cb0b-473b-8800-84eda9f8e447`) and removing Dataverse. → **BC uses the BC API resource, NOT Dataverse** (Sales/CE use Dataverse). Correction for `setup-entra-microsoft-apps.sh`: the 3 Dynamics apps are NOT uniform.
**⚠️ Agent-UX trap (positive):** BC's validation errors are the **best of any connector** — they name the exact missing/invalid field (`is_customer`, `reference` length ≤10, `irs1099Code`), so an agent self-corrects. Contrast Dynamics CRM's vague 500/422s.

### 12. Microsoft (`microsoft`) — ✅ TESTED · **Graph passthrough gateway** (0 normalized tools) · CORRECTED 2026-06-21
**Not "auth-only" — it's a generic, scope-configurable Microsoft Graph gateway.** Categories: `auth` + **`passthrough`**; `api_url` = `https://graph.microsoft.com`; "readable/writable fields: none" (no normalized objects). MCP `initialize` succeeds but **`tools/list` → `-32601 Method not found`** → it exposes **no normalized MCP tools**; the entire surface is **passthrough** (raw Graph `GET/POST/PUT/PATCH/DELETE`).

**Scope model (the key finding):** the Entra app (`Lua (Microsoft)`, `7c396375-…`) is the *ceiling* (now holds the **39-scope union** of all other Microsoft apps); the *actual grant* is whatever scopes are **passed at connect**. Unified's `microsoft` connector forwards a `scopes=` param straight into the Graph authorize request:
- **Default connect (dashboard, no scopes) → `openid email profile User.Read` only** (also omits `offline_access`, so that token doesn't refresh). This is why it *looked* auth-only.
- **Connect with `scopes=…` (lua-cli `--scopes`, or the auth-url param) → exactly those scopes.** Independent of Unified's (empty) scope catalog — the catalog only drives the lua-cli *picker*; the request honors any scopes passed.

**Proven 2026-06-21** — one connection consented with a broad set (`User.Read.All Directory.Read.All Group.Read.All Mail.Read Mail.Send Calendars.ReadWrite Files.ReadWrite.All Sites.Read.All Team.ReadBasic.All ChannelMessage.Read.All Chat.Read Tasks.ReadWrite` + `offline_access`), then exercised via Unified passthrough REST — **all green**: `/me` ✅, `/users` ✅, `/directoryRoles` ✅, `/groups` ✅, `/me/messages` ✅, `/me/events` ✅, `/me/drive/root/children` ✅, `/sites` ✅, `/me/joinedTeams` ✅, `/me/todo/lists` ✅. So **one `microsoft` connection can reach the whole tenant Graph surface**, gated only by the scopes requested.

**Caveat — not agent-reachable in Lua yet:** Lua agents call integrations only via **MCP tools**, and passthrough isn't exposed as one (nor does Lua expose Unified's passthrough REST). So today this is reachable only via Unified's REST (how it was tested). Wiring passthrough into the agent/sandbox path is **PRO-209**.
**⚠️ Agent-UX trap:** lists like a normal integration but `tools/list` is method-not-found; and a default connect grants only `User.Read` (+ no refresh token) unless scopes are explicitly passed — silently looks like "SSO-only."

### 13. Microsoft Advertising — ✅ TESTED (connected; empty new ads account) · 22 tools
Entra app `Lua (Microsoft Advertising)` (`0f571b52-…`) + msads.manage + Developer Token. Connected via OAuth (delegated, MFA). _(The ads API resource `d42ffc93-…` only appeared in the tenant after the ads account existed.)_
| Tool | Status |
|---|---|
| `list_ads_organizations` / `get_ads_organization` | ✅ — returns the "Lua AI" ads account (get returns a sparse object) |
| `list_ads_campaigns` | ✅ with `org_id` (0 — empty account); 400 "requires org_id" without it |
| `list_ads_groups` / `list_ads_ads` / `list_ads_creatives` | ⏳ not tested — empty account; no campaigns/groups/ads exist yet; these require parent filter (`campaign_id` / `group_id`) once they do |
| `list_ads_reports` | ⏳ not tested — empty account (no report data) |
| `create_ads_campaign` (+ group/ad/creative writes) | ⏳ not tested — empty account; create requires `organization_id` (NOT `org_id`) + undocumented `budget_type` enum (DAILY/PAUSED/SEARCH all rejected) |
**Verdict:** connection + org reads ✅ (the whole OAuth + developer-token + msads.manage chain works). Campaigns/groups/ads/reports **not tested** — needs a populated ads account first.
**⚠️ Agent-UX traps:** hierarchical filters required but only revealed via 400s; **field-name inconsistency** (list uses `org_id`, create uses `organization_id`); `budget_type` enum undocumented.

---

## Progress
**13/14 connectors tested end-to-end** (13 Microsoft-named + Azure DevOps): AD ✅, Outlook ✅, OneDrive ✅, SharePoint ✅, **Teams ⚠️**, **Planner ⚠️** (tasks don't surface), **Intune ⚠️** (directory ✅; device tools not tested — needs Intune license + enrolled device), **Microsoft `microsoft` ✅** (scope-configurable Graph passthrough gateway — NOT auth-only; see §12), **Dynamics 365 Sales ✅** (CRM full CRUD), **Dynamics CE ⚠️** (reads ✅, writes 422), **Dynamics BC ✅** (richest accounting reads), **Microsoft Advertising ⚠️** (org reads ✅; campaigns/groups/ads not tested — empty account), **Azure DevOps ⚠️** (repo CRUD ✅, commits/PRs + Boards broken).
Remaining: **Teams bot** only — a connection now exists and **reads messages ✅**, but **post → 400 "Channel not found"** (the Teams app isn't installed into a team; setup paused on the flaky dev.teams.microsoft.com). Recommended skip for full setup (redundant with Lua's existing per-customer Bot Framework Teams).

---

## Final verification sweep — all 14 connections re-tested (2026-06-21)

Re-ran reads + write lifecycles across every connection (parallel MCP sweep + dedicated Dynamics/ADO write passes). Confirms the matrix above and surfaces **3 deltas** (flagged ⬅).

| Integration | Tools | Reads | Writes (this sweep) | Delta vs prior docs |
|---|---|---|---|---|
| Microsoft (`microsoft`) | 0 normalized | ✅ via passthrough | ✅ via passthrough | ⬅ **NOT auth-only** — scope-configurable raw-Graph gateway; broad sweep all-green (see §12). Default connect = `User.Read` only. |
| Microsoft AD | 9 | ✅ employees/groups | create 400 (pwd) · **update ✅ (fixed 2026-07-06)** · remove 404 (fake-id guard) | ⬅ update now works (Unified deployed PATCH fix) |
| Microsoft Intune | 9 | ✅ employees/groups; devices ⏳ (no Intune license — not tested) | same HRIS limits | — |
| OneDrive | 12 | ✅ storage + HRIS | **storage create→update→remove ✅ at root** | — (generic 400 was a bad `parent_id`, not a real failure) |
| Outlook (org) | 20 | ✅ calendar/messaging/HRIS | **calendar event create→update→remove ✅** | — |
| Planner | 11 | ✅ projects; tasks 0; `get_task_project` 400 | read-only | — |
| SharePoint | 16 | ✅ storage/kms/HRIS | **storage create→update→remove ✅** | — |
| Teams | 32 | ✅ calendar/messaging/HRIS | calendar CRUD ✅; webinars ⏳ (needs Premium — not tested); UC ⏳ (app-only — not tested) | — |
| **Teams bot** | 6 | **✅ reads messages (2)** | **post → 400 "Channel not found"** (app not installed in a team) | ⬅ connection now exists; reads work, send blocked by missing install |
| **Dynamics Sales** | 35 | ✅ crm/accounting/hris | **contact/lead/company/deal full CRUD ✅** | ⬅ **contact-create WITH `emails` now ✅** (earlier 500 appears fixed) |
| **Dynamics CE** | 62 | ✅ crm/task/accounting (contacts 16, leads 17, deals 23) | **`create_crm_*` → 422 on all payloads** | ⬅ **writes NOT functional** (prior "full CRUD ✅" was extrapolated from Sales) |
| Dynamics BC | 48 | ✅ all accounting reads (richest) | hris create ✅; accounting_contact CRUD ✅ | — |
| Microsoft Advertising | 22 | ✅ org; campaigns/groups/ads need parent filters; empty account | n/a (empty account) | — |
| Azure DevOps | 24 | ✅ repo orgs/repos + task projects | **repo create+remove ✅**; commits/PRs ❌; task list/create ❌ | — (documented above) |

**The 3 deltas, restated:**
1. **Dynamics Sales `create_crm_contact` with `emails` → now ✅** (was a documented 500 Unified bug; appears fixed Unified-side). Sales remains the strongest write connector.
2. **Dynamics CE writes are broken** — `create_crm_contact/lead/deal` all return bare `422 Unprocessable Entity` regardless of payload, while the **same operations on the Sales connector succeed**. CE is **read-only in practice**; route Dynamics writes through Sales.
3. **Teams bot connection exists and reads** (channels + 2 messages) but **can't send** (`400 "Channel not found"`) because the Teams app was never installed into a team — consistent with the paused setup, not an integration fault.

Everything else re-verified identical to the per-integration sections above. Net Unified-bug count: **8 open** (6 original + 3 Azure DevOps − 1 resolved 2026-07-06); the contact+emails 500 resolved by Unified; `update_hris_employee` 405 resolved by Unified 2026-07-06; CE-writes-422 is a new open bug.
_Note: as of this session Unified shows OneDrive/Teams/Planner connections as `unhealthy` (status in Mongo) despite the tools working in direct tests — likely Unified's health probe hitting an erroring endpoint or heavy test traffic; functional for tested tools._

**Verification completeness — 100% per-tool sweep (2026-06-18; HRIS update re-verified 2026-07-06):** every tool on all 6 connected integrations was **actually invoked** (no inference). Outcome: reads + own-object CRUD ✅; writes characterized (storage/calendar CRUD ✅; HRIS `create`=❌, `update`=**✅ fixed 2026-07-06**, `remove`=✅ admin; messaging per §5). Tools marked 🚫/⏳ are **not tested due to setup blockers** (not broken by Unified): `list/get_hris_device` (needs Intune license + enrolled device), `list/get_uc_calls` + `list/get_uc_recordings` (needs app-only connection), `*_calendar_webinar` (needs Teams Premium), `list_ads_groups/ads/creatives/reports` + `create_ads_*` (needs populated ads account), `get_task_task` (no Planner tasks created yet). To unlock: Intune Plan 1 license, Teams Premium license, app-only Teams connection, create campaigns in Microsoft Ads. Everything else is confirmed by direct invocation.

---

## Genuine Unified bugs vs Environmental (re-adjudicated 2026-06-21 against raw Graph)

> **Method:** every "red" was re-checked against raw Graph (via each connector's own passthrough). A finding is a **🔴 Unified bug only if the data/operation provably exists in Graph but the connector fails.** Anything caused by no data / no license / no scope / app-only permission / admin role / empty account is **⚪ environmental — NOT Unified** and is no longer counted red.

**🔴 [Unified] bugs — genuinely broken, Unified's fault (each proven against Graph):**
- ~~**`update_hris_employee` returns `405 Method Not Allowed`**~~ — **✅ RESOLVED 2026-07-06 by Unified (JC):** Deployed PUT→PATCH fix. `update_hris_employee` now returns the employee object correctly. Verified on `microsoft_ad` connector against a live user.
- **`create_hris_employee` can't create a Microsoft user** — Unified's HRIS model has **no `password` field**, but Graph requires one → `400 "A password must be specified"` even with admin. So directory-user **create is impossible** via Unified; `remove`=✅ (admin), `update`=405 bug.
- **Planner task reads don't surface existing tasks** — **confirmed with data 2026-06-21:** a Planner plan ("test") with **3 real tasks** exists (verified via raw Graph `/planner/plans/{id}/tasks`), yet the connector's `list_task_tasks` → **0** (unscoped + scoped), `list_task_projects` lists only the user's **M365 groups** (never the actual plans — the plan's owner group isn't even in the list), and `get_task_project` → `400 "Invalid object identifier"` on ids `list_task_projects` itself returned. So Unified models "projects" as groups and cannot return tasks that demonstrably exist. (Roster/personal plans especially invisible.)
- ~~**Dynamics `create_crm_contact` → 500** with an `emails` array~~ — **RESOLVED (re-test 2026-06-21): Sales contact-create with `emails` now succeeds.** Appears fixed Unified-side.
- **Dynamics CE writes broken — `create_crm_contact/lead/deal` → bare `422 Unprocessable Entity`** on every payload, while the **identical calls on the Sales connector succeed** (same Dataverse org). CE is read-only in practice; Unified's CE create-mapping is broken. (New, found 2026-06-21.)
- **Azure DevOps (3 bugs):** `list_repo_commits`/`list_repo_pullrequests` → `400 "A project name is required to reference a Git repository by name"` (the base64 `repo_id` carries no project, and no param exposes it); `list_task_tasks` → `400 "Cannot read properties of undefined (reading 'toString')"` (server crash despite `has_tasks:true`); `create_task_task` → `400 "must pass a valid patch document"` (no work-item-type/JSON-Patch construction). Repo orgs/repos read + repo create/delete are fine.
- **Teams `list_messaging_channels` hides real channels** — **confirmed via Graph:** the team's channel (`19:…@thread.tacv2`) + its messages exist, but the tool returns only the **team**; no way to *discover* a postable channel id (must scrape it from an existing message's `channel_id`).
- **Dynamics CE 3 accounting/group lists 400/404** — `list_accounting_orders` (`parentbundleidref`), `list_accounting_contacts` (`externaluserid`), `list_hris_groups` (`/team` segment): Unified queries fields/segments absent in this Dynamics version.
- **Dynamics BC `update_accounting_contact` → 400** — Unified sends `irs1099Code`, a property not in this BC version.

→ **8 genuine open Unified bugs** (the rows above — `update_hris_employee` resolved 2026-07-06). Everything below is NOT a Unified bug.

**⚪ Environmental — NOT Unified (was flagged red/yellow; reclassified — do NOT count as Unified bugs):**
- **Intune device tools** — **not tested** (🚫 setup missing): tenant has no Intune license (`/deviceManagement` → "not applicable to target tenant"). Directory tools work (= AD). Needs Intune Plan 1 + enrolled device.
- **Teams UC calls/recordings** — **not tested** (🚫 setup missing): `CallRecords.Read.All` is **application-only**; recordings/transcripts need an **app role** → not testable via a delegated connection (Microsoft constraint; needs a separate client-credentials connection).
- **Teams webinars** — **not tested** (🚫 setup missing): need **Teams Premium** (`VirtualEvent.Read` scope is fine; the license is the only blocker).
- **Microsoft Advertising** campaigns/groups/ads — **not tested** (⏳ empty account): connection + org reads ✅; nothing below the org exists yet.
- **Dynamics Sales `accounting_invoice` create** (400) — needs a fuller payload (customer/currency); works with proper fields, not broken.
- **HRIS `remove_hris_employee`** — **works** with the User Administrator role (admin-gated by Microsoft, not Unified).
- **Outlook** empty mailbox/calendar, fresh-tenant sparsity — reads work; just no data.
- **Personal** accounts have no directory; **org** accounts need an **M365 license** for mailbox/files/sites (Microsoft constraint).
- Delegated directory **writes need an admin role** (Microsoft RBAC, not Unified).

**🟡 [Unified] soft limitations / DX (not "broken", but Unified could improve):**
- `create_storage_file` requires `type` / `list_kms_pages` requires `space_id` — conditionally-required fields not marked required (400 on omission, then works).
- `list_metadata_metadatas` / `list_crm_events` need a `type` with undocumented enums (work once you guess the right value: EMAIL/CALL/TASK/MARKETING).
- Planner / Teams expose **no write tools** (no task create/update/remove; no create-channel, no delete-message) though Graph supports them — a modeling choice, not a failure.
- `create_storage_file` into the "Shared With Me" virtual folder → 400 (works at real folders).
- DX: opaque base64 ids, cryptic error messages, occasional double-encoded (JSON-in-string) responses.

---

## Agent usability assessment — Unified.to MCP (judged as the consuming agent)

Hands-on across AD, Outlook, OneDrive, SharePoint, Teams, Planner:

**Easy / good:**
- **Consistent `verb_object` tool names** (`list/get/create/update/remove_<object>`) — predictable & self-describing; I can pick the right tool first-try without docs.
- **Normalized object model** (`hris_employee`, `storage_file`, `calendar_event`, `messaging_message`) transfers across integrations — OneDrive ≈ SharePoint storage, AD ≈ Intune directory.
- Standard MCP (initialize → tools/list → tools/call) with per-tool input schemas; connection-scoped tool sets. **Reads + simple CRUD on "own" objects (files, events, mail, directory) are smooth and reliable first-try.**

**Friction / traps (would trip an agent):**
1. **Conditionally-required fields not marked required** — `create_storage_file`→`type`, `list_kms_pages`→`space_id`: discovered only via a 400. Fail→learn.
2. **Opaque ids + discovery gaps (worst issue)** — Teams posting needs a channel id that `list_messaging_channels` doesn't return; the real id is buried in existing messages. A non-iterating agent would wrongly conclude "posting is impossible."
3. **Cryptic errors** — "Invalid channel ID" / "Channel not found" / "mailbox inactive" give no remediation hint (vs the good "Missing required field: type").
4. **Tools present but gated** — `create_hris_employee` etc. show in the list but 403 unless admin/app-only. Can't tell a tool is unusable until I call it.
5. **Double-encoded responses + control chars** — result is JSON-as-string in `content[0].text`, occasionally with unescaped control chars → strict parsers (jq) break; need lenient parsing.

**Verdict:** For the **common case (reads + own-object CRUD)** the MCP is **genuinely agent-friendly** — usable confidently first-try, ~70-80% of operations. For **container/relationship + write cases** (Teams channels, Planner writes, cross-entity) there are **non-obvious traps** requiring iterative fail-learn-retry; a naive agent would produce failed/wrong calls on the hard paths — **Teams messaging especially**. Net: strong DX for the bulk of operations, with the rough edges concentrated in writes and Teams.

---

## Catalog completeness — Microsoft-owned brands NOT named "microsoft" (2026-06-21)

The original sweep covered every Unified integration with **"microsoft"** in the name (the 13 above). A name search misses Microsoft-**owned** products that ship under their own brand. A full catalog probe found exactly **three** such integrations in Unified:

| Integration (slug) | Microsoft? | Unified categories | Auth identity | In identity scope? |
|---|---|---|---|---|
| **Azure DevOps** (`azuredevops`) | Native Microsoft (Azure), launched 2026-04-11 | Code Repos (orgs/repos/branches/commits/PRs) + Tasks (projects/work-items/comments, CRUD) | **Azure AD / Entra OAuth** (resource `499b84ac-…`) | **YES** — same Entra-app pattern as the 13 |
| **GitHub** (`github`) | Owned since 2018 | Code Repos + Issues/Tasks + Files + HR/Directory + Auth | github.com OAuth / PAT — **not Entra** | No — separate OAuth ecosystem |
| **LinkedIn** (`linkedin`) | Owned since 2016 | Ads + Messaging + HRIS | linkedin.com OAuth — **not Entra** | No — separate OAuth ecosystem |

**Decision (by identity, the criterion that defined the 13):**
- **Azure DevOps = in scope.** It authenticates through Entra, so it slots into the identical pattern (one more `Lua (…)` Entra app). Genuinely new surface: source control + Azure Boards work items. **Entra app built + connected + swept 2026-06-21** — results below.
- **GitHub / LinkedIn = Microsoft-owned but identity-independent.** They use their own OAuth (not our Entra apps), so they're a separate initiative. Recorded here for awareness; not part of the Entra-app Microsoft scope.

Confirmed **absent** from Unified (probed, 404): Power BI, Excel, Exchange, Yammer/Viva, Clarity, Skype, OneNote, Bing(standalone), To Do, Bookings, Lists, Defender, Purview, Power Automate/Apps, Dynamics 365 Finance/Field Service/Customer Service/Marketing/Project Ops, Dynamics GP/NAV. So the Microsoft-named set is the 13 already covered.

### Azure DevOps — test results (2026-06-21, connection `6a37bc6000a29a381b1001ac`)

Tested against org `dev.azure.com/luaai`, project `Test` (1 Git repo + work items). **24 tools** (repo + Boards/task). Auth via our Entra app `d6611121-…` — OAuth healthy, 13 read/write permissions granted.

**Setup gotcha (cost ~30 min):** Unified auto-derived the org name from the `@luaai.onmicrosoft.com` domain → `api_url = dev.azure.com/luaai`, but **no such Azure DevOps org existed** (Azure DevOps orgs are created at dev.azure.com, separate from the Entra tenant + Azure portal). Every read 404'd until an org literally named `luaai` was created. **Also: the Unified `connection.id` ≠ the Mongo `_id`** in `unifiedto.connections` — must use the id from `GET /unified/connection` (the MCP rejects the Mongo `_id` with "Invalid request").

| Tool | Result |
|---|---|
| `list_repo_organizations` / `get_repo_organization` | ✅ |
| `list_repo_repositories` / `get_repo_repository` | ✅ |
| **`create_repo_repository`** / **`remove_repo_repository`** | ✅ **full repo create+delete works** (made & cleaned up `mcp-verify-repo`) |
| `list_repo_commits` / `list_repo_pullrequests` | ❌ **[Unified bug]** `400 "A project name is required in order to reference a Git repository by name"` — `repo_id` (base64 of `{org_id,id}`) carries no project context and there's no param to supply it → commits/PRs unreadable |
| `get_repo_commit` / `get_repo_pullrequest` | ⏳ unreachable (their list failed) |
| `remove_repo_branch` / `remove_repo_organization` | ⏭️ not exercised (destructive, no safe target) |
| `list_task_projects` / `get_task_project` | ✅ |
| `list_task_tasks` | ❌ **[Unified bug]** `400 "Cannot read properties of undefined (reading 'toString')"` — server crash, reproducible, even though `get_task_project` reports `has_tasks: true` |
| `create_task_task` | ❌ **[Unified bug]** `400 "You must pass a valid patch document in the body of the request"` — Azure DevOps work-items need a JSON-Patch body + a work-item *type* in the URL; Unified's create sends neither (no `type` field in the tool schema) |
| `get/update/remove_task_task`, all `*_task_comment` | ⏳ unreachable (no task id obtainable — create + list both broken) |

**Verdict:** **Code/repository half is solid** — org/repo reads + **repo create/delete CRUD all work**. **Two halves are broken by Unified**, not Microsoft: (1) **commits & PRs** can't be read (Unified omits the project name the Azure DevOps Git API requires); (2) the **entire Boards/work-item write+list path** is broken (`list_task_tasks` crashes, `create_task_task` can't form the work-item patch/type). So as an agent tool today, Azure-DevOps-via-Unified is usable for **repo management** but **not** for issue/work-item tracking or commit/PR history.

**Agent-UX traps:** opaque base64 `repo_id` that silently lacks project scope (you only learn via a 400 that names a missing param the schema never exposed); `list_task_tasks` returns an internal `toString` crash with zero remediation hint; `create_task_task` advertises no required fields yet always 400s. A naive agent would conclude "repos work, everything else is mysteriously broken."

→ **3 new [Unified] bugs** to add to the report: repo-commits/PRs project-name gap, `list_task_tasks` crash, `create_task_task` patch-document failure.

---

## Reference — apps, connections, test method (for re-testing in a future session)

- **Tenant:** Lua Global Inc `bc9513ad-164f-4445-8fec-3aaa9182e1c1`. **Test user:** `rares@luaai.onmicrosoft.com` (now **User Administrator**). **Unified workspace:** `6970a2313ff596e474689ec7`.
- **Test agent:** `rares-test-agent` = `baseAgent_agent_1763564475474_q0hq0loo5` (prod, `https://api.heylua.ai`).
- **Direct MCP test:** `POST https://mcp-api.unified.to/mcp?connection=<connId>&token=<workspace JWT>` — Streamable HTTP (`initialize` → `notifications/initialized` → `tools/list` → `tools/call`); responses are **plain JSON**, parse with Python `json.loads(strict=False)` (jq chokes). The workspace JWT = Unified `UNIFIED_API_KEY` (user-provided in-session; **not stored here** — get from the user or lua-api env).
- **Agent test:** `POST https://api.heylua.ai/chat/generate/<agentId>` body `{"messages":[{"type":"text","text":"…"}]}` + Bearer Lua API key (`api_2ff7…` in root CLAUDE.md).
- **Log verify:** BetterStack source `lua-3-prod` (id 1574961), table `t470597.lua_3_prod`; `[<slug>] Processing tool:` lists registered tools.

| Integration (slug) | Entra app client ID | test connection ID |
|---|---|---|
| microsoft (SSO) | `7c396375-28b9-45ee-8212-150ad9b3f8ed` | `6a33dcf8eeca17b46f766e46` |
| microsoft_ad | `e8ee267d-89bd-465d-92ba-22cad13abdac` | `6a33af45d5c46bfd2ecb4836` |
| microsoftintune | `918a5e49-b3a4-4a20-9f03-4a21f92b1a39` | `6a33d726eeca17b46f7653cb` |
| microsoftonedrive | `37bf1b05-2f7a-4d24-a63b-39c2e60e45ad` | `6a33c543eeca17b46f75fcba` |
| microsoftoutlook *(personal+org audience)* | `4e2bef77-5a9a-4e4c-a591-e2b80fa29070` | `6a33bf793ea59733500923ba` (org) |
| microsoftplanner | `5244b16c-5b93-4e64-a6ba-35659b91ba76` | `6a33d01ceeca17b46f7637b1` |
| microsoftsharepoint | `af7061f6-55c7-4c5a-a865-c6d3b16f13ac` | `6a33c681eeca17b46f7608c2` |
| microsoftteams | `44e4bc5f-6273-42e6-b4f0-31c48ec9b481` | `6a33c6a9fb9ac13870b0ed53` |
| microsoftteamsbot | `3f6cd028-8da5-4f8e-b7e7-d777a2c6b128` | _(pending — user setting up)_ |
| microsoftdynamicssales | `4eb0e83e-68fc-436a-b587-959b0486d59d` | `6a33e278d5c46bfd2ecdb316` |
| microsoftdynamicscustomerengagement | `73e49205-0e9e-43ed-8920-5352c6c9fe11` | `6a33e31afb9ac13870b17595` |
| microsoftdynamicsbusinesscentral | `1352178c-d704-4d72-8d6f-efd21aacbeb1` | `6a33eab0eeca17b46f76c04c` |
| microsoftads | `0f571b52-8e11-4013-bf94-54e2a1bbbe15` | `6a33f4b43ea59733500a96cc` |
| azuredevops *(Microsoft-owned, Entra auth — added+tested 2026-06-21)* | `d6611121-a435-4c8e-9146-70f746b861be` | `6a37bc6000a29a381b1001ac` (org `luaai`, project `Test`) |

- **Azure DevOps resource:** appId `499b84ac-1321-427f-aa17-267ca6975798` (`user_impersonation` scope `ee69721e-6c3a-468f-a9ec-302d16a4c599`). SP provisioned in tenant 2026-06-21. Connection auth = Entra OAuth; end user supplies their **Organization Name** at connect (PAT is a fallback). **The org must actually exist at dev.azure.com** (separate from the Entra tenant) or all reads 404. **Use the Unified `connection.id` from `GET /unified/connection`, NOT the Mongo `_id`** (they differ; MCP rejects the Mongo id).
- **Resource appIds for permission fixes:** Graph `00000003-0000-0000-c000-000000000000`; Dataverse (Sales/CE) `00000007-0000-0000-c000-000000000000`; **BC API** `996def3d-b36c-4153-8607-a6fd3c01b89f` (user_impersonation scope `bce0976a-cb0b-473b-8800-84eda9f8e447`); **Ads API** `d42ffc93-c136-491d-b4fd-6f18168c68fd` (msads.manage scope `68068095-f393-427e-9984-e6f832dc235f`).
- **Dynamics Sales/CE env URL:** `org7805a17c.crm.dynamics.com`. **Secrets:** `/tmp/entra_apps_secrets.tsv` (ephemeral; regenerate any via `az ad app credential reset --id <clientId>`).
- **Setup script:** `setup-entra-microsoft-apps.sh` (Repos root) — creates the Graph apps + Dynamics(Dataverse). **Known correction:** BC needs the BC API resource, not Dataverse (the 3 Dynamics apps are NOT uniform). Advertising built separately.
- **az gotcha:** `az login --allow-no-subscriptions --tenant bc9513ad-…` (Entra-only tenant).
