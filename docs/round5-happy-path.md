# Round-5 test drive — the happy path for Ivo & team

A 15-minute script that walks the new features end-to-end: logging a sample, the one-time
email question, and the automatic pings to Quality and the Sales Trader. Written to be
forwarded to the team as-is; the **Diagnosis** section at the bottom is for us.

> All live. Pings go out Monday–Saturday, 07:00–19:00 Nairobi time, within ~15 minutes
> of an event — as a Teams DM if you've messaged the bot before, otherwise by email
> from **Sucafina Samples** (`ping@heymail.ai`). Check spam the first time and mark it
> "not spam".

## Before you start (once per person — traders AND Quality)

1. Open your **1:1 chat with the Lua bot** in Microsoft Teams and connect to the Sample
   Management Agent (connect code in `teams-agent-connect-instructions.md`).
2. **Send the bot one message** — a simple "hi" is enough. Once you've messaged it, your
   pings arrive as Teams DMs; before that they fall back to email.
3. Check the **Team page** in the dashboard (sidebar → Team): make sure your email and
   role (Sales Trader / Quality) are right — that's exactly who the bot notifies, and
   anyone on the team can fix it there.

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
for which trader — in Teams if they've messaged the bot before, otherwise by email from
Sucafina Samples. Log the sample as **urgent** ("send it urgently") and the ping carries
🔴 URGENT.

**Step 4 — preparing.** QC tells the bot (or sets the status in the dashboard):

> preparing TYPE-1018

Within ~15 minutes the Sales Trader gets: *"Your sample TYPE-1018 (…) is being prepared
by the lab."*

**Step 5 — dispatched.** When it goes out:

> TYPE-1018 dispatched with DHL, AWB 1234567890

The trader gets the dispatch ping with courier + AWB. If the AWB only comes later
("AWB for TYPE-1018 is 1234567890"), that lands as its own "AWB added" ping. Got the
dispatch date wrong, or recorded it late? Open the sample in the dashboard — **Dispatched
On** is editable in the side panel (pick the real date).

That's the whole loop: request → Quality ping → preparing → dispatched → AWB, with the
Sales Trader kept in the loop automatically at every step.

## What NOT to expect

- **No per-sample group chats** — the bot can't open a group chat itself. It can post into
  a group it's been added to (a desk group chat for callouts is the next step), but it
  answers questions 1:1.
- **If you messaged the bot before mid-August, message it again** — the bot moved to
  Sucafina's own Teams app then, and older conversations don't carry over.
- Only the **named Sales Trader** on the record gets the automatic updates. Extra people
  can be noted in the sample's comments.
- Outside 07:00–19:00 / on Sundays, pings hold and catch up in the next window.
- A person with **no email who has never DM'd the bot** can't be reached at all — the
  Team page shows exactly who that is.

## Diagnosis — when a ping doesn't arrive (internal)

Check in this order; every hop leaves a trace:

1. **Team page** (dashboard → Team): does the person have an email, and the right role
   (`Quality` gets new-request pings, the `Sales Trader` on a record gets status pings)?
   Same data raw: `GET /traders` with the API key from `.env`.
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
4. **Delivery channel** — `(email)` in the log for someone means they've never DM'd the
   bot, so the ping went out from Sucafina Samples (`ping@heymail.ai`) instead of Teams —
   have them check spam once, and send the bot a first DM to switch to Teams. A `skipped`
   mark means the person had no email on file at send time.
