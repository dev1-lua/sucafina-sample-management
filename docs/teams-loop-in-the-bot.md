# Looping the Sample Manager into a Teams conversation

For the Quality and Trade team. One page. Applies from app version 1.1.0 (September 2026).

## The one rule Teams imposes

A bot cannot be added to a 1:1 chat. That is a Microsoft Teams rule, not ours. So when a colleague DMs you a sample request, you have two ways to bring the bot in:

1. **Forward the request to the colleague AND the bot.** Open the message → ⋯ → *Forward* → in "Add recipients" pick your colleague **and** *Sucafina Sample Manager* → Forward. Teams creates a new group chat with the three of you. The bot reads the forwarded message, knows your colleague wrote it (they become the Sales Trader on the record) and knows you forwarded it (you are the logger).
2. **Add the bot to an existing group chat.** In the chat header click the people icon → *Add people* → type *Sucafina Sample Manager*. When it joins it reads the last 100 messages of that chat, so nobody has to repeat anything.

Then **mention it**: `@Sucafina Sample Manager log this` (or just `@Sucafina Sample Manager`). It answers only when mentioned or when you use one of its cards. Everything else in the chat is read quietly for context.

## Pick the right "Sample Manager"

If the search shows two entries called *Lua Sample Manager*, the older one is the retired shared bot and will be removed by IT. Use the entry named **Sucafina Sample Manager**. If you only see the old name, the new app version has not been published yet — tell Dev.

## What the bot does in a group chat

- **Attributes the request.** The person whose message asked for the sample is recorded as the Sales Trader; the person who mentioned the bot is the logger. Both get the status pings.
- **Routes missing details in the chat.** "Beyers has no address on file — @Tommie, could you send the street address and a contact?" is posted in the same chat, addressed to the colleague who has it (email copy to them and the Kenya QC desk). It no longer bounces the question back to you.
- **Knows who is in the chat.** Ask "who is in this chat?" or name a colleague ("ask Tommie") and it resolves them from the chat roster, emails included when Teams shares them.
- **Files attached in a group chat cannot be opened** (Teams gives the bot no permission). Paste the image into the chat or send the file to the bot 1:1.

## What stays private

Nothing from your 1:1 chat with the bot appears in a group chat, and nothing said in a group chat leaks into anyone's 1:1.

## If it seems deaf

- It was added before the new app version → remove it from the chat and add it again (permissions apply from the moment it is added with them).
- You did not mention it → it only answers when mentioned.
- You are in a 1:1 with a colleague → forward the message to the colleague and the bot (rule above).

## Soak test (Dev / QC, once per app version)

1. Publish the app version with the five permissions; remove and re-add the bot in one test group chat with three people.
2. Post two plain messages (no mention), then mention the bot: "what did we just say?" It should quote both, with names.
3. Mention a colleague by name in a request ("ask Tommie") and confirm the bot resolves them from the chat roster.
4. Trigger a missing-details ask and check it lands in the chat, addressed by name, with the email copy.
5. Create a new group chat, post three messages, add the bot, then ask "what did we discuss before you joined?".
6. Attach a file with the paperclip and ask about it; it should say it cannot read group-chat files and ask for an image or a DM.
7. In a team channel, start a post with a reply, mention the bot in another reply and ask what the thread is about.
