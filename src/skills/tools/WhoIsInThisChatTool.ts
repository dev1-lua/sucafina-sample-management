import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { currentConversation, type Conversation } from '../../lib/conversation';

/**
 * Who is in the Teams group chat this message came from — names the platform resolved (never taken
 * from the message text) and the work email when Teams shares it. Lets the model spell a colleague's
 * name right, pick up their email for the roster, and tell the Sales Trader (whose request was
 * forwarded / quoted) from the logger (who @mentioned the bot). Never exposes ids.
 */
export default class WhoIsInThisChatTool implements LuaTool {
  name = 'who_is_in_this_chat';
  description =
    'The people in this Teams group chat — display names as Teams resolves them, their work email when Teams shares it, and who is speaking right now. Use it to spell a colleague\'s name, to pick up their email (for the roster or a detail ask), and to tell the Sales Trader (the colleague whose message was forwarded / quoted, or who asked in the chat) from the person logging (who @mentioned me). In a 1:1 chat it returns group: false and nobody. Returns names and emails only.';

  inputSchema = z.object({});

  private conversation: () => Promise<Conversation>;

  constructor(opts: { conversation?: () => Promise<Conversation> } = {}) {
    this.conversation = opts.conversation ?? currentConversation;
  }

  async execute(_input: z.infer<typeof this.inputSchema>) {
    const c = await this.conversation();
    if (!c.isGroup) return { group: false, participants: [], note: 'This is a 1:1 chat — only the person chatting with me is here.' };
    return {
      group: true,
      participants: c.participants.map((p) => ({
        name: p.displayName,
        ...(p.channelIdentity?.email ? { email: p.channelIdentity.email } : {}),
        is_current_speaker: p.isCurrentSpeaker === true,
      })),
    };
  }
}
