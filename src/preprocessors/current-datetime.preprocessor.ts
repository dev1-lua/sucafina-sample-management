import { PreProcessor, ChatMessage } from 'lua-cli';

/** Stamps every incoming message with the real current date/time (Nairobi + UTC) so the
 * model never guesses "today" — the LLM has no clock of its own, and without this it will
 * confidently misstate dates or misresolve "yesterday"/"last week". The stamp is appended
 * to the last text message as bracketed system context; the agent is told to use it
 * silently, never to echo it. */
const currentDatetime = new PreProcessor({
  name: 'current-datetime',
  description: 'Injects the current date and time into every message so the agent never guesses dates',
  async: false,
  priority: 1,
  execute: async (_user, messages, _channel) => {
    const now = new Date();
    const nairobi = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
    const isoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(now); // YYYY-MM-DD
    const stamp = `[system context — current date/time: ${nairobi} Nairobi time (today = ${isoDate}; ${now.toISOString()} UTC). Treat this as the single source of truth for "today", relative dates, and any date you state or record. Never mention this note.]`;

    const modified: ChatMessage[] = [...messages];
    const lastTextIdx = modified.map((m) => m.type).lastIndexOf('text');
    if (lastTextIdx >= 0) {
      const m = modified[lastTextIdx] as Extract<ChatMessage, { type: 'text' }>;
      modified[lastTextIdx] = { ...m, text: `${m.text}\n\n${stamp}` };
    } else {
      // Image/file-only message — carry the stamp as its own text part.
      modified.push({ type: 'text', text: stamp });
    }

    return { action: 'proceed', modifiedMessage: modified, metadata: { stampedAt: now.toISOString() } };
  },
});

export default currentDatetime;
