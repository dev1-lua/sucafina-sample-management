import { LuaJob, User, env } from 'lua-cli';
import { apiFetch } from '../lib/api';
import { formatReminder } from '../lib/reminder-format';

// R1 — nudge for send-out samples that are still requested/preparing with no courier or AWB > 1 day old.
export const courierAwbReminderJob = new LuaJob({
  name: 'courier-awb-reminder',
  description: 'Weekday-morning nudge: samples still needing a courier + AWB arranged',
  schedule: { type: 'cron', expression: '30 6 * * 1-5', timezone: 'Africa/Nairobi' },
  execute: async () => {
    const { count, items } = await apiFetch('/reminders/courier-awb');
    const text = formatReminder('📦 Arrange courier + AWB', count, items);

    const userId = env('CHASER_USER_ID');
    if (userId && count > 0) {
      const user = await User.get(userId);
      await user.send([{ type: 'text', text }]);
    }
    return { success: true, count };
  },
});
