import { Channels, LuaJob } from 'lua-cli';
import { apiFetch } from '../lib/api';
import { feedbackChaserEmail, groupBy, type FeedbackItem } from '../lib/client-email';

// Omar: automatic email chaser to the CLIENT when no feedback has landed 7 days after
// delivery. The API's /notifications/feedback-due does the eligibility math (delivered
// ≥7 days, no verdict, no recorded feedback, client email on file, never chased, 30-day
// backlog guard); each row is chased exactly once (feedback_chased_at stamp). Distinct
// from the internal feedback-reminder job, which nudges the desk, not the client.
export const clientFeedbackChaserJob = new LuaJob({
  name: 'client-feedback-chaser',
  description: 'Email clients one feedback chaser 7 days after delivery with nothing recorded',
  schedule: { type: 'cron', expression: '0 10 * * 1-5', timezone: 'Africa/Nairobi' },
  execute: async () => {
    const { items } = (await apiFetch('/notifications/feedback-due')) as { items: FeedbackItem[] };
    // One client = one email listing everything they owe feedback on.
    const groups = groupBy(items, (i) => i.email);
    let sent = 0;
    let failed = 0;
    for (const group of groups) {
      const { subject, html, refs } = feedbackChaserEmail(group);
      try {
        const out = await Channels.email.send({ to: { email: group[0]!.email }, subject, html });
        if (out.warning) console.warn(`client-feedback-chaser: send warning for ${group[0]!.email}: ${out.warning}`);
        for (const item of group) {
          try {
            await apiFetch('/notifications/mark', {
              method: 'POST',
              headers: { 'x-actor': 'job:client-feedback-chaser' },
              body: JSON.stringify({ tab: item.tab, id: item.id, kind: 'feedback', email: item.email }),
            });
          } catch (e) {
            console.error(`client-feedback-chaser: MARK FAILED after send (possible duplicate next run) ${item.tab}/${item.id}`, e);
            failed += 1;
          }
        }
        sent += 1;
        console.log(`client-feedback-chaser: emailed ${group[0]!.email} for ${refs.join(', ') || group[0]!.id}`);
      } catch (e) {
        failed += 1;
        console.error(`client-feedback-chaser: send failed for ${group[0]!.email}`, e);
      }
    }
    return { success: true, due: items.length, emails_sent: sent, failures: failed };
  },
});
