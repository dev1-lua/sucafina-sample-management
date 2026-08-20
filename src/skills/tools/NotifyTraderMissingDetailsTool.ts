import { LuaTool, User } from 'lua-cli';
import { z } from 'zod';
import { currentUserName } from '../../lib/current-user';
import { loadTraders, matchTrader } from '../../lib/notify';

export default class NotifyTraderMissingDetailsTool implements LuaTool {
  name = 'notify_trader_missing_details';
  description =
    'DM the Sales Trader directly when their sample request is blocked on missing client details (name, phone, street address, email, country) and someone ELSE is doing the logging. Sends a 1:1 Teams message asking the trader to supply the gaps. Call at most ONCE per sample. Returns delivered:false with the reason when the trader cannot be reached — in that case tell the logger to chase the trader themselves; NEVER claim the trader was pinged.';

  inputSchema = z.object({
    trader_name: z.string().min(1).describe('The Sales Trader to reach, e.g. "Muki", "Ivo".'),
    sample_summary: z
      .string()
      .min(1)
      .describe('One compact line describing the sample being logged, e.g. "AB FAQ 300g → Beyers (Commercial)".'),
    missing: z
      .array(z.string())
      .min(1)
      .describe('The details still missing, e.g. ["client street address", "client phone number"].'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const traders = await loadTraders();
    const trader = matchTrader(input.trader_name, traders);
    if (!trader || !trader.email) {
      return {
        delivered: false,
        reason: `No contact on file for "${input.trader_name}" — ask the person logging to get the missing details from them directly.`,
      };
    }

    // Teams DM only, and only warm (they must have chatted with the bot before).
    // No email fallback here: a missing-details ask is a conversation, and the
    // answer has to come back to the bot — an email reply would dead-end.
    let user;
    try {
      user = await User.get({ email: trader.email });
    } catch {
      user = null;
    }
    if (!user) {
      return {
        delivered: false,
        reason: `${trader.name} hasn't chatted with me yet, so I can't message them — ask the person logging to get the missing details from them directly.`,
      };
    }

    const logger = await currentUserName();
    const first = trader.name.split(/\s+/)[0];
    const text = [
      `Hi ${first} — ${logger ?? 'a colleague'} is logging a sample for you (${input.sample_summary}) and I'm missing:`,
      ...input.missing.map((m) => `- ${m}`),
      `Could you send them here so I can finish the record?`,
    ].join('\n');

    try {
      await user.send([{ type: 'text', text }]);
    } catch {
      return {
        delivered: false,
        reason: `Couldn't reach ${trader.name} on Teams — ask the person logging to get the missing details from them directly.`,
      };
    }
    return { delivered: true, via: 'teams', trader: trader.name };
  }
}
