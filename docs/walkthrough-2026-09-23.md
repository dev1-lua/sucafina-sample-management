# Walkthrough script — 23 Sep 2026 (10 minutes)

Audience: Harriet, Brillian, Bernard, Daniel, Gloria (Ivo on leave). Presenter: Dev; Mayank frames.
Goal: show that the three things promised on 21 Sep are done, then the rest of the round, then collect answers to four questions.

Prep (5 min before): dashboard open on the Commercial book, a Teams group chat with Dev + a colleague + the bot, one test client with no address (e.g. "Demo Roasters"), TYPE-113 visible in the Commercial book.

## 1. Two samples never share a ref — unless they are the same coffee (2 min)
- Open the Commercial book. Point at the **×N pill** next to a ref (e.g. TYPE-973): "one ref = one coffee; the pill says how many times that coffee went out." Click it → the **Coffees** view opens with the lot expanded: three sends, three receivers, one ref. That is the desk's own convention (Sample Chaser sheet), now enforced.
- In chat: "log TYPE-113 for a 300g C FAQ type sample to Demo Roasters" → the bot answers "TYPE-113 is AB FAQ (sent to …). This is C FAQ — a different coffee, so it gets a new ref. OK?" → say yes → new ref issued. Then "same AB FAQ again to Joh Johanson" → "same coffee — reusing TYPE-973 (4th send)".
- Mention: existing clashes (the two TYPE-113 rows) were separated by the clean-up script; QC got a change alert naming old → new refs.

## 2. Orders: several coffees to one client (2 min)
- Chat: "AA, AB and C FAQ offer samples, 200g each, to EDMAX" → three refs + "Grouped as **CN-xxxx** — 3 samples → EDMAX".
- Dashboard **Orders** view: the order row (client, requested by, 3 samples, status). Open it: members with quality/qty/status, **Dispatch all** (one courier + AWB for the parcel).
- QC ping (show the email): "New order CN-xxxx for EDMAX — 3 samples", the client line with contact/email/phone and the 🆕 NEW CLIENT flag, CC to both QC mailboxes.

## 3. Forwarding a request in Teams (3 min)
- In Teams: a colleague DMs Dev "Beyers necesita muestra de AB, 2.5KG". Dev forwards it to the colleague **and** *Sucafina Sample Manager* → a group chat appears. Mention the bot: "log this".
- The bot logs it (Sales Trader = the colleague, logger = Dev), says the address is missing, and asks **in the chat**: "@Tommie — could you send Beyers' street address and a contact?" (plus the email copy). No bouncing back to Dev.
- Say the two rules: a bot cannot join a 1:1 (Teams rule) — forward or add it to a group; pick the entry named **Sucafina Sample Manager** (the old "Lua Sample Manager" is being removed). Hand out `docs/teams-loop-in-the-bot.md`.

## 4. Brillian's pings + roster rule (1 min)
- Team page: Brillian's row now has her email → she gets every ping. Try to add an external address → "Team emails must be @sucafina.com".
- Drawer → **In the loop**: add a second colleague to a sample; they get its status pings.

## 5. Still open on Sucafina's side (1 min)
- DHL API key (Daniel) and FedEx key (Brillian) → live AWB tracking switches on the day they land.
- Clean-up before 1 Aug 2026: ready, runs on your go after a backup (rows are hidden, not deleted; reversible).

## Questions to settle today
1. Labels: Sucafina logo next to the Kenyacof mark, or Kenyacof only? (No Sucafina logo file exists yet — send one if yes.)
2. Ping CC: `kenyaqc@sucafina.com` **and** `kenyacof.specialtyqc@sucafina.com`, or one of them?
3. One real SOL export (Excel/CSV) so the PSS import mapping is confirmed on real columns.
4. Who else should be on the Quality roster (Gloria? Margaret Mbugua?) — everyone on it gets every new-request ping.
