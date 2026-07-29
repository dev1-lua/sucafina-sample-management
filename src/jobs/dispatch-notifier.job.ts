import { Channels, LuaJob } from 'lua-cli';
import { apiFetch } from '../lib/api';
import { dispatchEmail, groupBy, type DispatchItem } from '../lib/client-email';

// Anicka: once samples are marked dispatched, the client gets the courier + AWB by
// email automatically. Polls the API's queue (rows with dispatched_on stamped, a client
// email on file, and no dispatch_notified_at) every 15 minutes during desk hours — a
// job rather than a dispatch-tool hook so dashboard-recorded dispatches email too.
// Idempotency: /notifications/mark is stamped only AFTER a successful send, so a failed
// send self-retries next run; a failed mark after a sent email risks one duplicate
// (logged loudly) rather than a silent gap.
export const dispatchNotifierJob = new LuaJob({
  name: 'dispatch-notifier',
  description: 'Email the client courier + AWB once their samples are marked dispatched',
  schedule: { type: 'cron', expression: '*/15 7-19 * * 1-6', timezone: 'Africa/Nairobi' },
  execute: async () => {
    const { items } = (await apiFetch('/notifications/dispatch-pending')) as { items: DispatchItem[] };
    // One shipment = one email: rows sharing the client email + AWB travel together.
    const groups = groupBy(items, (i) => `${i.email}|${i.awb ?? i.id}`);
    let sent = 0;
    let failed = 0;
    for (const group of groups) {
      const { subject, html, refs } = dispatchEmail(group);
      try {
        const out = await Channels.email.send({ to: { email: group[0]!.email }, subject, html });
        if (out.warning) console.warn(`dispatch-notifier: send warning for ${group[0]!.email}: ${out.warning}`);
        for (const item of group) {
          try {
            await apiFetch('/notifications/mark', {
              method: 'POST',
              headers: { 'x-actor': 'job:dispatch-notifier' },
              body: JSON.stringify({ tab: item.tab, id: item.id, kind: 'dispatch', email: item.email }),
            });
          } catch (e) {
            // Email went out but the stamp failed — next run would re-email this row.
            console.error(`dispatch-notifier: MARK FAILED after send (possible duplicate next run) ${item.tab}/${item.id}`, e);
            failed += 1;
          }
        }
        sent += 1;
        console.log(`dispatch-notifier: emailed ${group[0]!.email} for ${refs.join(', ') || group[0]!.id}`);
      } catch (e) {
        // Send failed — leave unmarked so the next run retries; keep going with the rest.
        failed += 1;
        console.error(`dispatch-notifier: send failed for ${group[0]!.email}`, e);
      }
    }
    return { success: true, pending: items.length, emails_sent: sent, failures: failed };
  },
});
