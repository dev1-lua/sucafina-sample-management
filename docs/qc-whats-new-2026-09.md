# What's new for the Quality team — September 2026

For Harriet, Bernard, Dennis, Brillian and Anička. Everything below is live once the September deploy lands (the top of this page says when). Ask Dev if anything here doesn't match what you see.

## 1. In one paragraph

The bot no longer holds a sample request hostage over a missing client address. A request is written the moment the coffee, type, quantity and receiver are known; a missing address becomes a visible flag on the record and an *ask* routed to the colleague who has it, chased every morning. In return, you are now told about every deletion or change to an existing request, the dashboard asks who is using it so changes carry a name, and labels carry the Sucafina logo plus the outturn.

## 2. "Address needed" — how a missing address now works

- A sample logged for a client with no street address on file is still logged. It shows **⚠ address pending** on the chat card, an amber **Address needed** badge in the three books and on the client list, and the same line on your new-request ping: *"⚠ No delivery address on file for Beyers — asked Tommie Schretlen (email, 8 Sep) · chased daily"*.
- The bot asks the person in the chat ONE question ("Who has Beyers' delivery address: you, or someone I should ask?") and routes the ask to that colleague — Teams DM if they have chatted with the bot, otherwise email with the QC desk mailbox and the person logging copied. It records who was asked and when; the client page shows it.
- Every morning at 09:00 the desk nudges the asked person again; after two unanswered nudges the person who logged the sample and the client's account manager are copied too. It stops the moment an address is saved — by anyone, in chat or on the dashboard.
- Before you record a dispatch on a flagged row the bot asks once where it went and saves it. Nothing else blocks on the address.
- **Dashboard:** you can now add or complete a contact and address on an existing client from the client page (Edit → "Add a contact or delivery address", or the **Add address** button on the amber banner). The "Address needed" filter on each book lists what is still open.
- Any office whose name contains "Sucafina" or "Kenyacof" is internal and never flagged.

## 3. You are told about deletions and edits

- Any deletion of a sample, client or consignment — by anyone, chat or dashboard — reaches the Quality team within the usual 15 minutes.
- Any edit to a sample's **request definition** by someone outside the Quality team — quality/description, grade, quantity, client, receiver, country, priority, shipment month, contract number, blend, phyto answer, or a cancellation — reaches you too, with the old and new values.
- Your own work (dispatch, AWB, delivery date, results, stock, location, comments) does not ping you.
- Changes are grouped into one message per 15-minute run: *"Sample request changes (3) — • DELETED TYPE-112 — AB FAQ → Paulig • 300 g • Commercial — by Ivo (chat) at 14:02 • EDITED SL-7461 — qty 300 g → 500 g — by Muki (dashboard) at 13:50 …"*. Deleting a sample also cancels any of its pings still waiting to go out.

## 4. Say who you are on the dashboard

The dashboard asks for your name the first time you open it (pick yourself from the Team list or type it). It goes on every edit and deletion so the alerts above can say *who*. Change it any time from the chip in the top bar. In chat nothing changes — the bot already knows who is typing.

## 5. Keep-in-the-loop: colleagues only

The question after a new client's first sample now reads *"Which Sucafina colleague should be updated once we have the AWB or if there are follow-up questions? Please share their @sucafina.com email."* A client's own email (nestle.com, itochu.co.jp …) is saved on the client's book entry instead — that is where dispatch confirmations go — and the bot asks once more for a colleague. Three customer contacts that had ended up on the internal roster were moved back to their client records.

## 6. Labels

Printed labels now carry the Sucafina wordmark, the sample type, and — for Specialty — the **outturn** as a large second line under the ref; PSS labels show the contract number and container. Consignment labels list each member with its outturn. Tell Dev which part of the outturn should be biggest and whether Commercial samples need an outturn field too.

## 7. Still to come (next deploys)

- **Pre-shipment samples:** the 45-day rule — PSS due dates computed from the shipment date, reminders at 14/7/0 days, an upload of the SOL PSS report that creates one PSS per container and nests them per contract ("2 of 3 approved"; one rejection tolerated, the replacement is drawn automatically). Needs one real SOL export from Harriet to finalise the column mapping.
- **Courier tracking:** DHL and FedEx looked up automatically once an AWB is on the record — delivered dates filled in, customs holds and address problems pinged to you and the account manager. Needs Sucafina's DHL/FedEx developer keys.
- **Clean-up:** everything dated before 1 August 2026 hidden from the books (kept in the database, reversible). Runs only on an explicit go after a backup.

## 8. Things we still need from you

- Work emails for Ivo, Muki, Omar, Brian and Gloria on the Team page (the bot fills them in as each of them chats, but sooner is better).
- One real SOL PSS export (Excel or CSV).
- The vector Sucafina logo (SVG) and your answer on the outturn layout.
- DHL Express and FedEx account numbers, and a Sucafina mailbox to own the developer-portal registrations.

## 9. When pings arrive

Every 15 minutes, Monday–Saturday, 07:00–19:00 Nairobi. Teams DM for anyone who has messaged the bot at least once; email from "Sucafina Samples" (ping@heymail.ai) for everyone else, always with the QC desk mailbox in copy. Replies by email do not reach the bot — answer on Teams, or reply-all to the people copied.
