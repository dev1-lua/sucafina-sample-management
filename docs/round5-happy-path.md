# Round-5 test drive — the happy path for Ivo & team

A 15-minute script that walks the new features end-to-end: logging a sample, the one-time
email question, and the automatic pings to Quality and the Sales Trader. Written to be
forwarded to the team as-is; the **Diagnosis** section at the bottom is for us.

> Live from agent **v27**. Pings go out Monday–Saturday, 07:00–19:00 Nairobi time, within
> ~15 minutes of an event.

## Before you start (once per person — traders AND Quality)

1. Open your **1:1 chat with the Lua bot** in Microsoft Teams and connect to the Sample
   Management Agent (connect code in `teams-agent-connect-instructions.md`).
2. **Send the bot one message** — a simple "hi" is enough. This is what lets the bot's
   pings reach you *in Teams*; until you've messaged it once, your updates arrive by
   email instead (or wait until we have your email).

## The happy path

**Step 1 — log a sample.** Anyone messages the bot, e.g.:

> Ivo wants a 300g AB FAQ type sample sent to Paulig

The bot fills in what it can, asks one question at a time for anything missing (client
address, phyto certificate, …), echoes the finished record, and after your "yes" replies
with the reference (e.g. **TYPE-1018**).

**Step 2 — the email question (first time only).** If the Sales Trader on the record has
no email saved yet, the bot asks:

> Who should be updated once we have the AWB or if there are follow-up questions? Please share the email.

Reply with the address, e.g. `ivo.sarjanovic@sucafina.com`. That's now saved — this
person gets every automatic status update from here on, and the bot never asks again for
that trader.

**Step 3 — Quality hears about it.** Within ~15 minutes, Harriet and Bernard each get a
"New sample request" message with the ref, quality, receiver, quantity, and who logged it
for which trader — in Teams if they've messaged the bot before, otherwise by email. Log
the sample as **urgent** ("send it urgently") and the ping carries 🔴 URGENT.

**Step 4 — preparing.** QC tells the bot (or sets the status in the dashboard):

> preparing TYPE-1018

Within ~15 minutes the Sales Trader gets: *"Your sample TYPE-1018 (…) is being prepared
by the lab."*

**Step 5 — dispatched.** When it goes out:

> TYPE-1018 dispatched with DHL, AWB 1234567890

The trader gets the dispatch ping with courier + AWB. If the AWB only comes later
("AWB for TYPE-1018 is 1234567890"), that lands as its own "AWB added" ping.

That's the whole loop: request → Quality ping → preparing → dispatched → AWB, with the
Sales Trader kept in the loop automatically at every step.

## What NOT to expect

- **No group chats** — Teams bots can only message people 1:1 (platform limitation; a
  group-send feature request is open with Lua).
- Only the **named Sales Trader** on the record gets the automatic updates. Extra people
  can be noted in the sample's comments.
- Outside 07:00–19:00 / on Sundays, pings hold and catch up in the next window.

## Diagnosis — when a ping doesn't arrive (internal)

Check in this order; every hop leaves a trace:

1. **Roster** — `GET /traders` (with the API key from `.env`): does the person have an
   email, and the right role (`qc` gets new-request pings, `trader` gets status pings)?
2. **Queue** — `GET /notifications/outbox-pending`: is the event queued? `attempts`
   climbing means sends are failing/skipping; rows are marked only AFTER a successful
   send, and unresolvable ones age out at 5 attempts.
3. **Logs** — `lua logs --ci --json`, then grep by prefix:
   - `status-notifier:` — every delivery decision of the ping job: who was sent what via
     `teams`/`email`, what was skipped and why, what failed.
   - `save_notify_contact:` — each roster save: created vs updated, which roster row a
     full name matched onto, the stored role.
   - `notify: no email on file` — the moment a create decided intake should ask the
     email question.
   - `notify_trader_missing_details:` — each direct missing-details ask: delivered, cold
     Teams contact (never DM'd the bot), or no email on file.
   - `notify:` — per-recipient Teams→email fallbacks and email failures.
4. **Teams warm-up** — a `skipped`/fallback for someone with an email usually just means
   they've never DM'd the bot (see *Before you start*).
