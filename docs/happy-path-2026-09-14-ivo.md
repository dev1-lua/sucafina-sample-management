# Test drive for Ivo — "from ask to AWB" (14 Sep 2026)

A 15-minute script that walks your whiteboard flow end to end: you ask the bot, the bot
asks you two details, Quality gets told, the AWB comes back to **you** the moment it is
typed in. Written to be forwarded as-is; the **Diagnosis** section at the bottom is for us.

> Pings go out Monday–Saturday, 07:00–19:00 Nairobi time, within ~15 minutes of an event —
> as a Teams DM if you've messaged the bot before, otherwise by email from **Sucafina Samples**
> (`ping@heymail.ai`, check spam the first time). Every email is also copied once to the Specialty
> QC desk mailbox.

## Before you start (once per person — traders AND Quality)

1. Open your **1:1 chat with the Lua bot** in Microsoft Teams (connect code in
   `teams-agent-connect-instructions.md`) and send it one message — "hi" is enough. After that
   your pings arrive in Teams; before that they fall back to email.
2. Dashboard → **Team**: check your name has your email and the right role (Sales Trader /
   Quality). That list is exactly who the bot can reach. A trader with no email on file gets
   nothing.

## The happy path (what you should see)

**1 — you ask.** In your Teams chat with the bot:

> pls send an AB FAQ type sample to my client Baba Coffee in Antwerp

**2 — the bot asks once, for what it doesn't know.** If Baba Coffee has no delivery address on
file (a new client always), it asks in one line:

> Ok, one detail: what's Baba Coffee's delivery address? If someone else has it, say who — or 'skip' — and I'll log it now.

For a PSS to a client with no usual PSS size it also asks the quantity in the same line:

> Ok, I need a few details: what's Baba Coffee's delivery address, and how much coffee in the sample?

Answer however suits you — paste the address, give "500 g", say "ask Tommie, he has it", or
just "skip". **Any answer logs the sample.** It never asks twice. (Two questions you may still
see, both from earlier rounds: *phytosanitary certificate?* the first time a client abroad is
sent to — answer once, set a default on the client page and it stops — and, for a PSS, a check
when the contract number isn't in the schedule.)

**3 — the bot echoes the row and, on your "yes", writes it.** The echo shows the quality, qty,
receiver, sample type, `Sales Trader: Ivo` and `Deliver to: …` (or ⚠ no address — asking Tommie).
Then the card with the reference, e.g. **TYPE-142**, and a link into the dashboard. If you skipped
the address, the card says *⚠ address pending* and the bot tells you who it asked (or that the
desk will chase it each morning).

**4 — Quality hears about it.** Within ~15 minutes Harriet and Bernard get "New sample request
TYPE-142 — AB FAQ → Baba Coffee • 300 g • logged by Ivo", with *address pending* on it when that
is the case. Nothing for you to do.

**5 — Quality prepares and books DHL, then types the AWB into the dashboard** (or tells the bot
"AWB for TYPE-142 is 1234567890"). The row now shows **awaiting collection** in the dashboard
(status column and a filter of the same name) — booked, not yet picked up.

**6 — you hear back, without asking.** Within ~15 minutes:

> Your sample TYPE-142 (AB FAQ) for Baba Coffee has a DHL AWB 1234567890 — it'll be on its way soon.

This reaches the person who asked (you), whoever typed it in for you, and the client's account
manager if there is one. No set-up, no "keep me in the loop". One condition: your row on the
Team page needs your email — the bot fills it in by itself the first time you chat with it, so
step 1 of "Before you start" is all it takes. Until then the bot still asks, once per client,
"which Sucafina colleague should be updated once we have the AWB?" — answer or say "skip".

**7 — DHL collects; Quality sets the status to dispatched.** You get one more line:

> TYPE-142 (AB FAQ) for Baba Coffee is on its way — DHL AWB 1234567890.

If Quality entered the AWB and the status within the same quarter hour you get only this one,
not both. Baba Coffee gets its own dispatch email (courier + AWB) if their email is on file.

**8 — chase your client.** Ask the bot any time:

> where is TYPE-142?

Before pickup: *"TYPE-142 has DHL AWB 1234567890, awaiting collection"*. After: dispatched with
the last courier scan once Sucafina's DHL key is in (until then, the log). Delivered and results
follow the same way.

## Also try

- **Address you don't have:** answer the one-line question with *"ask Tommie"* — the bot emails
  Tommie (QC desk copied), records who was asked, and chases him every morning at 09:00 until the
  address is saved. You're not the go-between.
- **Logging for someone else:** *"Muki wants 300 g AB FAQ to Paulig"* — `Sales Trader: Muki` on the
  echo; Muki gets the AWB ping, and so do you as the person who logged it.
- **Urgent:** add "urgent" — 🔴 URGENT on the card and on Quality's ping, sorted first for them.

## What NOT to expect

- The bot answers 1:1; it does not open group chats.
- It never claims a ping already went out — it says "QC will get a ping" / "you'll hear once it
  has an AWB". Pings arrive as separate messages within ~15 minutes, lab hours only.
- If your roster entry has no email, the AWB ping cannot reach you: fix it on the Team page once.

---

## Diagnosis (for us)

What each step proves, and where to look if it doesn't happen:

| Step | Mechanism | If it fails |
|---|---|---|
| 2 | `find_client`/`get_client` → `address_missing` / `usual_pss_grams`; intake skill "DETAILS BEFORE WRITING" | agent version < 1.0.26 of sample-intake; check `lua version diff` |
| 3 | create tool → `POST /{book}-samples`; `request_missing_details` when skipped | `client_detail_requests` row on the client; `details_requested` event on the sample |
| 4 | outbox `created` → status-notifier → roster `role=qc` | `/notifications/outbox-pending`; Team page emails; job log `status-notifier` |
| 5 | dashboard PATCH `{awb}` → outbox `awb_added`; API `awaiting_collection` | needs API deployed with `gapColumns` change; `GET /specialty-samples?awaiting_collection=true` |
| 6 | job `autoLoopIns([requested_by, logged_by])` + account manager | skip note on the timeline names an unresolved/ambiguous roster name |
| 7 | `enqueueStatusEvents` supersedes pending `awb_added` on dispatch | outbox row `last_error = 'superseded: dispatched'` |
| 8 | `status-and-tracking` skill reads `awaiting_collection` | API not yet deployed → flag absent → plain "requested" |

Verified before this doc went out (14 Sep): API test suite (384), dashboard (98 + build), agent unit
tests (15), the log-first harness against a local API (ALL GOOD), and the sandbox conversation
(`npm run qa:sketch`, two threads: Type with "skip" → ⚠ address pending, one-line ask, echo, card,
status answer; PSS → address + quantity in one line, address saved on the client, SSKE ref). Steps 5–7
need the API and the new agent version live; they are covered by the API tests and the notifier unit
tests, and are the first thing to watch after deploy (`docs/HANDOVER-2026-09-14-lifecycle-sketch.md` §7).
