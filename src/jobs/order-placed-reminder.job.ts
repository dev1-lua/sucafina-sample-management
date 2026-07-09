import { LuaJob, User, env } from 'lua-cli';
import { apiFetch } from '../lib/api';
import { formatReminder } from '../lib/reminder-format';

// R3 — 15 days after delivery, ask whether the order was placed off the sample (order_placed empty).
export const orderPlacedReminderJob = new LuaJob({
  name: 'order-placed-reminder',
  description: 'Weekday-morning nudge: was an order placed ~15 days after a sample was delivered?',
  schedule: { type: 'cron', expression: '40 6 * * 1-5', timezone: 'Africa/Nairobi' },
  execute: async () => {
    const { count, items } = await apiFetch('/reminders/order-placed');
    const text = formatReminder('🧾 Order placed after sample?', count, items);

    const userId = env('CHASER_USER_ID');
    if (userId && count > 0) {
      const user = await User.get(userId);
      await user.send([{ type: 'text', text }]);
    }
    return { success: true, count };
  },
});
