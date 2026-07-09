import { LuaJob, User, env } from 'lua-cli';
import { apiFetch } from '../lib/api';
import { formatReminder } from '../lib/reminder-format';

// R2 — chase client feedback on dispatched/delivered samples with nothing recorded > 3 days old.
export const feedbackReminderJob = new LuaJob({
  name: 'feedback-reminder',
  description: 'Weekday-morning nudge: sent samples still awaiting client feedback',
  schedule: { type: 'cron', expression: '35 6 * * 1-5', timezone: 'Africa/Nairobi' },
  execute: async () => {
    const { count, items } = await apiFetch('/reminders/feedback');
    const text = formatReminder('💬 Chase client feedback', count, items);

    const userId = env('CHASER_USER_ID');
    if (userId && count > 0) {
      const user = await User.get(userId);
      await user.send([{ type: 'text', text }]);
    }
    return { success: true, count };
  },
});
