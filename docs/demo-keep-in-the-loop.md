# Keep-in-the-loop — live demo (26 Aug 2026)

Verbatim transcript from the production bot (Teams chat, thread `demo-loop-in-1805`). Demo client
"Nordic Roasters Oy" and the three people are fictional and were removed afterwards; nothing else
was touched. Refs shown (`TYPE-111`, `SL-7463`) come from the restarted numbering.

**What it answers:** *"We log who requested the sample, but the client's Account Manager (the Sales
Trader) is the one who needs the pings. If the bot asked 'who else needs to be in the loop' that
would be a big time save."*

---

**Ivo:** Specialty lot: Muki wants a 300g type sample of AB FAQ, Kabingara/Kirinyaga, Kenya, sent to Nordic Roasters Oy. No phyto cert needed.

> Row ready:
>
> **AB FAQ — Kabingara/Kirinyaga** • Type sample • 300g • → Nordic Roasters Oy • Specialty • Sales Trader: Muki • Phyto: No
>
> Confirm and I'll log it?

**Ivo:** yes

> **TYPE-111 · AB FAQ — Kabingara/Kirinyaga**
> 2026-08-26 • Specialty • Type • AB • Kenya • 300g → Nordic Roasters Oy • requested • ✨ just created
>
> [Open TYPE-111 in Specialty →]
>
> I'll nudge Muki as it progresses (preparing, dispatched, AWB). **Who should be updated once we have the AWB or if there are follow-up questions? Please share the email.**

**Ivo:** Thomas Berg, thomas.berg@sucafina.com

> Done — Thomas will get updates on Nordic Roasters Oy samples going forward.

**Ivo:** Also a Specialty offer sample, 300g AA Swara, Kenya, for Nordic Roasters Oy — my request, no phyto. Go ahead, no need to confirm.

> **SL-7463 · AA Swara**
> 2026-08-26 • Specialty • Offer • AA • Kenya • 300g → Nordic Roasters Oy • requested • ✨ just created
>
> [Open SL-7463 in Specialty →]
>
> I'll nudge you on courier/AWB, then chase Nordic Roasters' feedback once sent, then ~15 days after delivery on the order.

*(No question this time — Nordic Roasters already has Thomas on file.)*

**Ivo:** keep Petra Lind in the loop on that one

> Petra isn't on the roster yet — what's her email?

**Ivo:** petra.lind@sucafina.com

> Petra will get updates on SL-7463.

**Ivo:** who gets updates on Nordic Roasters Oy samples now?

> Thomas Berg (thomas.berg@sucafina.com) — account manager for Nordic Roasters Oy, so he's updated on every sample to them. Petra Lind is additionally in the loop on SL-7463 specifically.

---

## What happens behind the scenes

- **The question is asked once per client**, right after the ref, only when that client has no
  account manager with an email on file. Answer with a name and email, or just the email — the bot
  saves the person to the Team roster and sets them as the client's account manager. Every future
  sample to that client is covered; the bot never asks again for that client. Say "don't know" or
  "skip" and it drops the subject.
- **The requester stays the requester.** "Sales Trader: Muki" on the record is who asked; Thomas
  is who gets kept posted. Two different people, both recorded.
- **What Thomas receives, automatically, with nothing forwarded:** *"Your sample TYPE-111 (…) is
  being prepared by the lab"* → *"TYPE-111 is on its way — DHL AWB 1234567890"* → *"AWB added…"*
  when the AWB comes later. Delivered as a Teams DM if he has messaged the bot before, otherwise by
  email from **Sucafina Samples**. Pings go out every 15 minutes, 07:00–19:00 Nairobi, Mon–Sat.
- **Per-sample extras:** "keep Petra in the loop on SL-7463" adds her to that one sample only.
  "Petra handles Nordic Roasters" would make her the account manager instead. Someone already on the
  Team page needs no email; a new person is asked for it once.
- **Everything is visible on the dashboard:** the client page shows "Account manager — kept in the
  loop"; the Team page manages people, emails and roles; each sample's timeline records every ping
  ("people in the loop notified: preparing — Thomas Berg (email)").

## What we'd like from the team

1. Confirm the account managers for the current clients (or just answer the bot's question the
   first time each client comes up — it fills itself in).
2. Everyone who used the bot before mid-August: send it one message in Teams so pings arrive as
   Teams DMs rather than email.
