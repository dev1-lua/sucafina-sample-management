# Sucafina Sample Agent → Microsoft Teams — Conversation Handover

> Handover of an in-progress design conversation (Claude Code). Goal: put the existing
> Sucafina "Sample-management-agent" into the Quality/Trade **Microsoft Teams** chat so the
> team can drive the sample log by chatting, and get back a **dashboard deep-link** to the
> record that just changed. This doc lets a fresh session pick up exactly where we left off.
>
> **Status:** brainstorming/design (no code written yet). Last updated 2026-07-08.

---

## 0. HANDOVER PROMPT — paste this into a new Claude Code chat

```
You are continuing work on the Sucafina Sample-management-agent → Microsoft Teams project,
in the repo /Users/devashishthapliyal/Documents/work/Lua/Sucafina.

FIRST: read TEAMS-AGENT-HANDOVER.md (this file) in full, plus MICROSOFT-CAPABILITIES.md and
docs/"Quality - Trade Teams Chat.docx" (convert with `textutil -convert txt`). We were in the
middle of the superpowers:brainstorming flow — invoke that skill and resume at "present the
design / write the spec", do NOT start implementing until the design + spec are approved.

We are building TWO things in this repo:
  (A) Agent replies with a dashboard deep-link after every write (create sample / dispatch /
      result / client edit).
  (B) The dashboard makes that link land on a "just updated" highlighted view.
Plus a Teams-bot setup RUNBOOK (docs) — the Teams/Unified wiring itself is the Lua platform
team's job (Rares/Lawrence), not repo code.

Decisions already made:
  - Transport: Microsoft Teams (bot) via Unified. Inbound = native webhook events → the Lua
    chat pipeline → the SAME agent that already answers on dev/pop. Outbound = Unified
    Messaging API / MCP. No repo code needed for inbound routing itself.
  - Link scope: link after EVERY write.
  - Landing UX: open the record's DetailDrawer + a "✨ Just created/updated" banner + row flash.
  - Teams setup deliverable: code + a setup runbook (+ starter manifest).

OPEN STRATEGIC DECISION (needs the user): should the bot be an AMBIENT OBSERVER of the whole
chat (auto-logs requests/dispatches/results from natural messages) or an @MENTION command bot,
or phased both? The real chat transcript shows the team never @mentions a bot — they just talk
— which argues for ambient. See §5. Confirm direction before finalizing the spec.

Next concrete steps: §9.
```

---

## 1. What the user wants (in their words)

- "Make a Sucafina agent for Microsoft Teams so I can just chat things over there, which will
  update things in my interface like we usually do. Once it is updated, it sends a URL for the
  interface — click it and you see the updated thing. Make these changes in both the interface
  and the agent."
- The bot is meant to live in the real **"Quality / Trade"** Microsoft Teams chat
  (`docs/Quality - Trade Teams Chat.docx`), where Sucafina Kenya traders and QC coordinate
  green-coffee samples.
- User = Dev (dev@luaimplementation.ai), Lua implementation engineer building this for Sucafina.

## 2. Project coordinates

| Thing | Value |
|---|---|
| Repo | `/Users/devashishthapliyal/Documents/work/Lua/Sucafina` |
| Agent name | **Sample-management-agent** (model `anthropic/claude-sonnet-5`, active) |
| Agent ID | `baseAgent_agent_1783420556773_cc6qh9f2y` |
| Org ID | `d9764ee0-5a19-4c0d-9407-a2e2e489a827` |
| Backend API | `https://sucafina-api.luameet.in` (Contabo VPS, Docker; public behind a light API-key gate) |
| Dashboard | Vercel project `sucafina-sample-management` (React + Vite + react-router). No login gate (demo). |
| Dashboard base URL | assumed `https://sucafina-sample-management.vercel.app` — **CONFIRM the real domain** |
| Agent skills | sample-intake, client-book, dispatch-logging, status-and-tracking, results-capture (+ daily-chaser job) |
| Channels seen in logs | `dev` (sandbox) + `pop` (LuaPop web widget). **No `teams` channel yet.** |

## 3. How we got here (the diagnosis that started this)

- User showed a Teams chat "Lua Teams Ops Assistant" not responding to "add some samples".
- Investigated via `lua logs`: the agent is **healthy** (answers on `dev`/`pop`, tools run). But
  across 100 user messages there were **zero `teams`-channel events** → Teams messages never
  reached the agent. Root cause: **the Teams channel isn't wired to this agent.** Not a code bug.
- That turned into: "let's actually build the Teams agent properly."

## 4. Architecture decision — Teams bot via Unified (SETTLED)

Established in a Slack thread with Rares Astilean + Lawrence Perera (Lua platform):

- **Two different layers, not competing:**
  - *Unified `microsoftteams` OAuth connector* = the agent gets capabilities **as an identity**
    (read/send in Graph as e.g. `sucafina@sucafina.onmicrosoft.com`). Good for acting on Teams
    content; NOT an assistant surface.
  - *Teams app (Bot Framework)* = a named, installable **assistant surface** users chat with /
    @mention, with messages pushed to a messaging endpoint in real time. This is what gives the
    "chat with the assistant" UX.
- **Decision:** use **Microsoft Teams (bot)** integration via Unified.
  - **Inbound** = native webhook events (Unified) → Lua chat pipeline → the agent.
  - **Outbound** = Unified Messaging API / MCP tool (prompt-instructed).
  - Bot must be packaged, uploaded, installed into the relevant Team/chat.
  - Guide: https://docs.unified.to/guides/how_to_set_up_a_microsoft_teams_bot_with_unified
- **Key implication for us:** inbound routing needs **no repo code** — once the webhook forwards
  to the Lua chat pipeline, the *same* agent responds. Teams messages will show up as a new
  channel in `lua logs` (e.g. `teams`).
- **OPEN (Lawrence confirming):** whether **DMs to the bot AND @mentions** both arrive as
  real-time webhook events for Teams Bot, and whether **all channel messages** (not just
  @mentions) can be delivered — this gates the "ambient observer" option in §5.
- Sucafina likely does **not** need the Unified Teams *message* tools — the agent's real actions
  hit the Sucafina backend, not Teams content. Teams is just the conversation transport.

See `MICROSOFT-CAPABILITIES.md` for the full Unified.to × Microsoft capability matrix (Teams
messaging read ✅, post-to-known-channel ✅, channel discovery is the weak spot; bot connector
reads ✅ but posting needs the app installed in a team).

## 5. THE KEY INSIGHT from the real chat (needs a decision)

`docs/Quality - Trade Teams Chat.docx` is the actual Quality/Trade group chat (~6 weeks: 21 May →
2 Jul). Participants: traders (Ivo, Omar, Muki, Brian) + QC/lab (Bernard, Brillian, Harriet,
Anička, Gloria, Margaret, kenyacofspecialtyqc). The sample-desk workload is **already flowing
through this chat naturally** and almost none of it is directed at a bot:

- **Requests (~10):** "AB FAQ / ABC FAQ / Heavy Mbuni → Thomas Pitault at Beyers"; "prepare
  samples for Folgers — Kenya AA + Kenya Millstone"; "2kg AB Swara for Taiwan / UCC Taiwan";
  "1kg shipment sample, 3rd Sangalai AA container → China"; "Edmax 7 bags AB".
- **Dispatch confirmations w/ AWB (~8):** "Key coffee 872526345980 Fedex"; "AA SWARA 4215427635
  DHL"; "Jojo 1487722062 DHL"; "ABC → Geneva 7726241423 DHL"; "China DHL Waybill 1042774655";
  "Thomas/Beyers DHL AWB 9620551651"; "Folgers DHL 4720858811".
- **Cupping results:** "Type ABC -82+ … PSS3: 83p, citrus driven, clean".
- **Status queries (~5):** "summary of what we've shipped to Zoegas this year"; "how many samples
  to Geneva?" → "2: PSS-2, PSS-3"; "confirm Joy Johnson received the samples?".

**Conclusion:** an @mention-only command bot would capture ~nothing without forcing the team to
change behavior. The higher-value framing is an **ambient observer** that reads the chat and keeps
the sample log in sync automatically, posting a short confirmation + dashboard link; @mention
becomes the secondary path for queries/corrections. **Same agent + tools + deep-link feature.**

**Costs/risks of ambient (why it's an open decision, not a done deal):**
1. Inbound must deliver **all** channel messages (Graph subscription / RSC `ChannelMessage.Read.All`),
   not just @mentions — the exact thing Lawrence is confirming. @mention-only is trivial by comparison.
2. Must be **conservative**: distinguish discussion ("can we send X?", "is June too tight?") from
   instruction ("send X") from confirmation ("dispatched, AWB Y"). False positives pollute the log.
3. Must handle **quoted/threaded** replies — "Yes and yes", "option 2", "Correct" only parse with
   the quoted parent for context.
4. In a group it **can't interrogate** for missing fields the way the current 1:1 persona does
   (persona.ts gathers gaps one at a time + confirms before writing — that's a DM pattern). Observer
   mode needs: log what's given, flag incompletes, at most one gentle nudge — never pepper the channel.

**Recommended path:** one agent, designed for BOTH modes, **phased** — @mention first (works the
moment Teams is wired), ambient capture next (once event coverage confirmed). Use this transcript
as an **eval/demo**: replay it against the agent to prove the log self-builds before Teams is live.

## 6. Current system state (what already exists — verified)

**Agent (src/):**
- `persona.ts` — "Kenyacof Sample Desk" persona, already Teams-toned ("like the team's own Teams
  messages"), 1:1 assistant behavior (route to Specialty/Bulk/Forwarding, gather gaps, confirm
  before writing). Will need observer-mode tuning if we go ambient.
- Skills: `sample-intake` (create specialty/bulk/forwarding + find_client), `client-book`,
  `dispatch-logging`, `status-and-tracking`, `results-capture`; job `daily-chaser`.
- Write tools & return shapes (relevant to deep-links):
  - `create_specialty_sample` → `{ tab:'specialty', id, ref, ... }` ✅
  - `create_bulk_sample`, `create_forwarding_sample`, `create_sample_request` → similar (verify)
  - `record_dispatch` → `{ updated: [ { tab, id, ref, status, courier, awb }, ... ] }` (BATCH — one
    AWB can cover many rows → needs a link PER row)
  - `record_result` → `{ tab, id, ref, status, result, comments }` ✅
  - `upsert_client` → raw client object, **no `tab`** → must add `tab:'clients'` + url
- `src/lib/api.ts` — `apiFetch(path, init)` using `env('API_BASE_URL')` + `env('API_KEY')`.
- `src/lib/normalize.ts` — has `TABS`, `TAB_ENDPOINT` (endpoints differ from dashboard paths).

**Dashboard (dashboard-v2/, React + Vite + react-router-dom):**
- Deep-linkable routes ALREADY EXIST (`src/App.tsx`):
  - `/samples/:id` (specialty), `/bulk/:id`, `/forwarding/:id`, `/clients/:id` — each opens a
    `DetailDrawer` (lazy) that fetches the record by id. Works on cold load (BrowserRouter +
    vercel.json rewrites all paths to index.html).
- Tab → path map (from `src/tabs/*.tsx`): specialty→`/samples`, bulk→`/bulk`,
  forwarding→`/forwarding`, clients→`/clients`.
- Env: `VITE_API_BASE`, `VITE_API_KEY`, `VITE_LUA_AGENT_ID` (LuaPop widget → this agent).

## 7. The design we landed on (deep-link feature) — the "code" part

**Approach (chosen):** tools return the URL; persona surfaces it (agent never *constructs* URLs).
Fallback if QA shows dropped links: a postprocessor that auto-appends the link.

1. **`src/lib/links.ts` (new)** — `dashboardUrl(tab, id, event)` →
   `${DASHBOARD_BASE_URL}${PATH[tab]}/${id}?hl=${event}` where
   `PATH = { specialty:'/samples', bulk:'/bulk', forwarding:'/forwarding', clients:'/clients' }`,
   `event ∈ {created, updated}`. New env var **`DASHBOARD_BASE_URL`** (set on the Lua platform for
   sandbox + production, like `API_BASE_URL`).
2. **Write tools return `url`** (7 tools): create_* → event `created`; record_dispatch → `url` per
   item in `updated[]` (event `updated`); record_result → `url` (updated); upsert_client → add
   `tab:'clients'` + `url`.
3. **Persona/skill rule:** after a successful write, end with the record's link so they can view
   it. Emit a **bare URL** (Teams auto-links bare URLs reliably; markdown link is less certain).
   Multi-row dispatch → one line per ref → link.
4. **Dashboard "just updated" landing:** the `:id` route reads `?hl=created|updated` → show a
   banner in the DetailDrawer ("✨ Just created" / "✨ Just updated" + record's created_at/updated_at)
   + a brief row-flash highlight. Stateless, works cold.
5. **Teams bot setup runbook** (`docs/teams-bot-setup.md` + starter `manifest.json`): Unified
   Teams-bot connector, app package + install, inbound webhook → Lua agent, outbound via
   Messaging API/MCP, `DASHBOARD_BASE_URL` note, and the open event-coverage item.

**Out of scope (YAGNI):** real dashboard auth (public demo), in-app SPA nav for the link
(full-page load is fine), Unified Teams *message* tools.

## 8. Decisions made vs open

**Made:** transport = Teams bot via Unified · link after every write · landing = drawer + "just
updated" highlight · deliver code + runbook · link built in tools (not by the LLM).

**Open:**
1. **Ambient observer vs @mention vs phased-both** (§5) — the big one; get user direction.
2. **Exact dashboard production domain** for `DASHBOARD_BASE_URL`.
3. Lawrence's confirmation on Teams Bot event coverage (DMs + @mentions + all-messages, real-time).
4. Observer-mode persona tuning (only if going ambient).

## 9. Next steps

1. Confirm the §5 direction (ambient / @mention / phased) + the dashboard domain (§8).
2. Resume `superpowers:brainstorming`: present the final design section-by-section, then write the
   spec to `docs/superpowers/specs/2026-07-08-teams-agent-deeplinks-design.md`, self-review, get
   user approval, commit.
3. Then `superpowers:writing-plans` → implementation plan. Only then implement:
   - `src/lib/links.ts` + wire `url` into the 7 write tools + persona/skill rule.
   - dashboard `?hl=` banner + row-flash.
   - `docs/teams-bot-setup.md` + `manifest.json`.
4. Test BEFORE Teams is live via the LuaPop widget / `lua chat` sandbox (feature is channel-agnostic).
   Replay the Quality/Trade transcript as an eval (§5).
5. Platform side (Rares/Lawrence, not repo): stand up the Unified Teams-bot connection, install the
   app into the Quality/Trade chat, wire the inbound webhook to this agent, set `DASHBOARD_BASE_URL`
   for sandbox + production.

## 10. Environment gotchas

- **`lua deploy` guard hook over-matches**: a Bash PreToolUse hook (`confirm-deploy.mjs`) blocks
  some compound commands (pipes/`;`/loops) with `DEPLOY_DENIED_BARE` even when there's no deploy.
  Workaround: run single, simple commands; use Read instead of grep-in-a-loop.
- `.docx` → text: `textutil -convert txt -output <out.txt> <in.docx>` (macOS native).
- Deploys go through `/lua-deploy` (never bare `lua deploy`); pushes via `/lua-push`.
```
