# Sucafina Sample Desk — Client Discovery Questionnaire

**Purpose:** sharpen the AI sample-management agent so it fits how the Kenya (Kenyacof)
quality & trade team *actually* works — not how we guessed it works from the spreadsheet.
Every question below, once answered, changes something concrete: a routing rule, a default,
a reminder cadence, a required field, or how we ship it into Teams.

**How to use this:** it's grouped by who knows the answer. You don't need one person to fill
the whole thing — send each section to the right people. Short answers are fine; a real
example (an actual message, an actual sample row) is worth more than a paragraph.

**Suggested respondents**

| Section | Best answered by |
|---|---|
| A. How work really flows | Traders + QC/lab together |
| B. The three books & routing | QC/lab lead |
| C. Fields, defaults & refs | QC/lab (whoever fills the sheet) |
| D. Clients & contacts | Trade desk |
| E. Dispatch & couriers | QC/lab (whoever ships) |
| F. Live courier tracking | Ops / IT |
| G. Cupping results & feedback | QC/lab |
| H. Chasing & reminders | Whoever owns "the chase" today |
| I. Teams / where the agent lives | IT / M365 admin + a lead trader |
| J. Reporting & visibility | Management |
| K. Voice, language & trust | Everyone (quick gut-check) |
| L. Priorities & what "done" means | Project sponsor |

---

## A. How work really flows today

1. Walk us through **one real sample, start to finish** — from the moment someone decides
   to send it, to the moment you consider it "closed." Who touches it at each step?
2. Where does a sample request usually *start* — a Teams message, a WhatsApp, an email, a
   verbal ask, straight into the spreadsheet? Roughly what share each?
3. Who is allowed to **request** a sample? Who actually **prepares and ships** it? Who
   records the **cupping result**? Are those ever the same person?
4. What's the single most annoying / time-wasting part of the current spreadsheet-plus-Teams
   way of doing this? (If the agent fixed one thing, what should it be?)
5. When something goes wrong today (wrong grade sent, sample lost, client says "never
   arrived"), how do you find out, and what do you do?

## B. The three books & routing

> Today the agent splits every sample into **Specialty**, **Bulk**, or **Forwarding** and
> tries to route silently. We want to confirm that split is right and that it can tell them
> apart from a plain-English message.

6. Is Specialty / Bulk / Forwarding the **right and complete** set of books? Is anything
   missing (e.g. internal retention, marketing, calibration, WOC), or are any of these three
   not really how you think about it?
7. Give us **2–3 real one-line requests** for each book, exactly as a trader would type them.
   (These become our routing test cases.)
8. Are there requests that genuinely **span two books**, or that even *you* have to stop and
   think about which book they belong in? What's the tell that decides it?
9. **Forwarding** currently gets no cupping/result step (parcels just move under an AWB).
   Correct? Is there ever a case where a forwarded parcel *does* get a verdict?
10. For a **PSS (pre-shipment sample)** — we treat these as highest-priority with the
    tightest follow-up. Is that the right call, or is something else more urgent?

## C. Fields, defaults & reference numbers

> The agent refuses to write a half-empty row. So we need to know exactly what's *mandatory*
> vs *nice-to-have*, and what to assume when it's not said.

11. For each book, which fields are **truly mandatory** before a sample can be logged, and
    which are optional / fill-in-later? (Grade, outturn mark, moisture, ICO mark, water
    activity, deadline, destination country, requester…)
12. Our default quantities are **offer 200 g, type 300 g, PSS 1 kg**. Are those right? What
    should the default be when someone doesn't say a quantity?
13. **Reference numbers** — today we issue `SL…`, `TYPE…`, `SSKE…` server-side. How do you
    generate refs today? Should the agent mint them, or must they match an existing scheme
    exactly? Who "owns" the numbering?
14. What are the **valid grades / outturn marks** we should recognize and validate against?
    (A list means the agent can catch typos instead of writing garbage.)
15. Is there a field you *wish* you captured but the spreadsheet never had room for?

## D. Clients & contacts

> The agent now insists on a full client record (contact person, email, phone, address)
> before logging a sample for a **new** client, across all three books.

16. Is requiring full contact details for a **new** client realistic, or does that block
    people mid-task? Where's the line between "must have" and "capture later"?
17. Some high-volume receivers (JDE, Nestrade, Sucafina NV) have **no contact record** in the
    source data. Should the agent auto-create a client from just a name, or always stop and
    ask? Are these "internal" receivers that should be treated differently from external
    roasters?
18. How do you refer to clients in messages — full legal name, short name, a person's name
    ("send to Thomas at Beyers")? The agent needs to resolve all of these to one record.
19. Who is allowed to **add or edit** a client's details — anyone, or only certain people?

## E. Dispatch & couriers

20. When QC ships samples, what does the "it went out" message actually look like today?
    (Paste a couple of real ones — they train how the agent recognizes a dispatch.)
21. Is **one AWB → several samples** common? One dispatch message covering a batch? The agent
    needs to split/attach correctly.
22. Beyond DHL / FedEx / UPS / local rider (Kiptoo) / hand-delivery / client-pickup — any
    couriers or hand-off methods we're missing?
23. Do you ever ship **partial** (some of the requested samples now, the rest later)? How
    should that show up?

## F. Live courier tracking

> Right now tracking is **simulated** — the agent invents a plausible status from the AWB.
> This is the clearest "prototype vs real" gap.

24. How important is **real, live** courier tracking (vs. just recording the AWB)? Would the
    team actually use it, or is "we have the AWB, we'll check ourselves" fine?
25. Which couriers matter most to track? Do you already have **API access / accounts** with
    DHL / FedEx / UPS (or use a tracking aggregator like AfterShip / 17track)?
26. When a delivery is confirmed, who/what confirms it today — the courier site, a client
    saying "got it," or nobody?

## G. Cupping results & feedback

> This is the biggest data gap we found: in the real spreadsheet the **Result column is
> mostly empty** — verdicts lived in email/chat and never got recorded. So samples sit
> "delivered" forever even after they were cupped.

27. When a client cups a sample, how does the verdict come back to you today (email, call,
    Teams), and does it *ever* get written down anywhere structured?
28. What does a result actually contain — a score, approved/rejected, tasting notes, a
    decision to buy? What's the **minimum** you'd want the agent to capture?
29. Would the team realistically **tell the agent** the result ("SL8123 cupped 84, clean,
    approved") if it were easy? What would make them actually do it?
30. Should the agent **chase the client** for feedback, chase the internal trader, or both?

## H. Chasing & reminders

> The agent has a chaser and three reminder jobs (they're built but currently switched off).
> The timings below are **our guesses** — we need your real thresholds.

31. Today, **who owns "the chase"** — noticing what's overdue and poking people? How do they
    do it? (This is the job we're trying to automate.)
32. Confirm or correct these thresholds:
    - Not yet dispatched — chase after **____** days past the deadline (we guessed *"past due"*).
    - Dispatched, no delivery confirmation — chase after **____** days (we guessed **5**).
    - Delivered, no result yet — chase after **____** days (we guessed **7**).
    - "Was the order placed?" follow-up — **____** days after delivery (we guessed **15**).
33. Should reminders go to the **person who logged it**, the **client**, a **shared channel**,
    or a single "sample desk owner"? Different rules per book?
34. What time / days should the daily chase run? (We assumed **weekday 6am Nairobi**.)
35. Is there such a thing as **too many** nudges here — would people mute it? What's the right
    frequency before it becomes noise?

## I. Teams / where the agent lives

> This is the biggest open **product** decision. Two very different shapes:
> **(a)** a 1:1 assistant you DM privately, vs **(b)** a bot you can **@mention inside a group
> chat** mid-conversation and it acts. They need different Microsoft setup.

36. Which do you actually want — **DM the assistant privately**, **@mention it in a group
    thread**, or **both**? Picture the real moment you'd use it.
37. If @mention-in-a-group: whose messages should it read — only when tagged, or should it
    follow the whole thread? (Privacy + noise implications.)
38. On the Microsoft side: is there an **M365 admin** who can consent to the app/permissions,
    and can IT create a **dedicated service account** for the bot? Who's our contact there?
39. Should the agent live **only in Teams**, or also the web chat widget / WhatsApp? Where do
    these conversations *actually* happen today?
40. Any data-residency, privacy, or "the agent must not see X" rules we need to respect
    inside the tenant?

## J. Reporting & visibility

41. What does **management** want to see at a glance — a weekly digest, a live dashboard, a
    number in a Teams message? What's the one report worth having every Monday?
42. Which numbers matter: overdue count, average time-to-dispatch, approval rate, samples per
    client, cost of samples shipped? Rank the top 3.
43. Who should have access to the **dashboard** vs just the **chat**? Does it need real logins
    per person (today it's a single shared password)?

## K. Voice, language & trust

44. The agent talks **brief and chat-native** ("Well noted", "Done", "Logged") and uses your
    jargon (PSS, Types, FAQ, AWB, outturn, cupping). Does it sound like the team, or too
    casual / too terse? Any words it uses wrong?
45. Any **languages other than English** in play (French for Sucafina NV, Swahili locally)?
    Should it understand or reply in them?
46. For the agent to be **trusted with real records**, what must be true? (e.g. "it must never
    guess a value," "it must always show me the row before saving," "I must be able to undo.")
47. Where should the agent **stop and escalate to a human** rather than act? (Today it won't
    price, allocate stock, or approve shipments — is that the right boundary?)

## L. Priorities & what "done" means

48. If this replaced the spreadsheet **next month**, what are the 3 things that *absolutely
    must* work, or the team won't switch?
49. What would make people quietly **keep using the spreadsheet** instead? (The honest
    failure modes.)
50. Six months out — what would make you say "this became indispensable"? What's the dream
    that's out of scope for the spreadsheet entirely?

---

### For our team (not for the client) — how answers map to changes

| Answers in… | Let us change… |
|---|---|
| A, B | Persona routing rules; add/remove a book; real-world test cases |
| C | Tool required-field schemas (Zod); default quantities; ref issuance |
| D | New-client capture rules; internal-vs-external handling; name resolution |
| E | Dispatch-logging tool (batch AWB, partial ships); courier enum |
| F | Swap simulated tracking for a real `TrackingProvider`; pick a provider |
| G | Result-capture schema; whether to add client-facing feedback chase |
| H | Turn the parked reminder jobs back on with correct thresholds & recipients |
| I | Teams: DM bot vs. @mention bot; Unified vs. native bot; identity setup |
| J | Dashboard access model; management digest job |
| K | Persona tone, multilingual support, escalation boundaries |
| L | Roadmap & definition-of-done |
