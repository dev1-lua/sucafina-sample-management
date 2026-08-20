import { LuaJob } from 'lua-cli';
import { apiFetch } from '../lib/api';
import { loadTraders, matchTrader, sendToPerson, type TraderRow } from '../lib/notify';

// Ivo Jr. (feedback #29/#30): the Quality team hears about every sample request the
// moment it's logged in full, and the Sales Trader hears as their sample progresses
// (preparing / dispatched / AWB added). Drains the notifications_outbox queue the API
// fills in-transaction on create/PATCH — a job rather than a tool hook so dashboard
// edits notify too. Per person: warm Teams DM first, email fallback (lib/notify).
// Idempotency mirrors dispatch-notifier: /notifications/outbox-mark is stamped only
// AFTER a successful send, so a failed send self-retries next run; unresolvable
// recipients are marked 'skipped' and age out after 5 attempts (API-side cap).

type OutboxItem = {
  outbox_id: string;
  tab: 'specialty' | 'bulk' | 'forwarding';
  sample_id: string;
  event: 'created' | 'preparing' | 'dispatched' | 'awb_added';
  recipient: string | null;
  ref: string | null;
  title: string | null;
  receiver: string | null;
  status: string;
  courier_norm: string | null;
  awb: string | null;
  qty_grams: number | null;
  priority: string | null;
  requested_by: string | null;
  logged_by: string | null;
  client_name: string | null;
};

const BOOK: Record<OutboxItem['tab'], string> = { specialty: 'Specialty', bulk: 'Commercial', forwarding: 'Forwarding' };

function describe(i: OutboxItem): string {
  const bits = [i.title, i.receiver ? `→ ${i.receiver}` : null, i.qty_grams ? `${i.qty_grams}g` : null, BOOK[i.tab]]
    .filter(Boolean)
    .join(' • ');
  return `${i.ref ?? '(no ref)'} — ${bits}`;
}

function traderMessage(i: OutboxItem): { text: string; subject: string } {
  const label = describe(i);
  if (i.event === 'preparing') {
    return {
      text: `Your sample ${i.ref ?? ''} (${i.title ?? '?'} → ${i.receiver ?? '?'}) is being prepared by the lab.`,
      subject: `Sample ${i.ref ?? ''}: being prepared`,
    };
  }
  if (i.event === 'awb_added') {
    return {
      text: `AWB added for ${i.ref ?? 'your sample'}: ${i.awb ?? '?'}${i.courier_norm ? ` (${i.courier_norm})` : ''}.`,
      subject: `Sample ${i.ref ?? ''}: AWB added`,
    };
  }
  // dispatched
  return {
    text: `${i.ref ?? 'Your sample'} is on its way — ${i.courier_norm ?? 'courier'}${i.awb ? ` AWB ${i.awb}` : ''}. (${label})`,
    subject: `Sample ${i.ref ?? ''}: dispatched`,
  };
}

function qcMessage(i: OutboxItem): { text: string; subject: string } {
  const urgent = i.priority === 'urgent' ? ' 🔴 URGENT' : '';
  const people = [i.logged_by ? `logged by ${i.logged_by}` : null,
                  i.requested_by && i.requested_by !== i.logged_by ? `for ${i.requested_by}` : null]
    .filter(Boolean).join(' ');
  return {
    text: `New sample request${urgent}:\n- ${describe(i)}${people ? `\n- ${people}` : ''}`,
    subject: `New sample request${urgent ? ' (URGENT)' : ''}: ${i.ref ?? i.title ?? ''}`,
  };
}

async function mark(id: string, via: 'teams' | 'email' | 'skipped', detail: string | null) {
  await apiFetch('/notifications/outbox-mark', {
    method: 'POST',
    headers: { 'x-actor': 'job:status-notifier' },
    body: JSON.stringify({ id, via, detail }),
  });
}

export const statusNotifierJob = new LuaJob({
  name: 'status-notifier',
  description: 'Ping the Quality team on new sample requests and the Sales Trader as status progresses',
  schedule: { type: 'cron', expression: '*/15 7-19 * * 1-6', timezone: 'Africa/Nairobi' },
  execute: async () => {
    const { items } = (await apiFetch('/notifications/outbox-pending')) as { items: OutboxItem[] };
    if (!items.length) return { success: true, pending: 0, sent: 0, skipped: 0, failures: 0 };
    const traders = await loadTraders();
    const qc = traders.filter((t) => t.role === 'qc' && t.email);
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const item of items) {
      try {
        if (item.event === 'created') {
          if (!qc.length) {
            await mark(item.outbox_id, 'skipped', 'no Quality-team members with an email on file');
            skipped += 1;
            continue;
          }
          const { text, subject } = qcMessage(item);
          const delivered: Array<{ t: TraderRow; via: 'teams' | 'email' }> = [];
          for (const t of qc) {
            const via = await sendToPerson({ email: t.email!, text, subject });
            if (via) delivered.push({ t, via });
          }
          if (!delivered.length) {
            // Every send failed — leave unmarked so the next run retries.
            failed += 1;
            console.error(`status-notifier: created ping failed for all QC recipients (${item.ref})`);
            continue;
          }
          const anyTeams = delivered.some((d) => d.via === 'teams');
          const detail = delivered.map((d) => `${d.t.name} (${d.via})`).join(', ');
          await mark(item.outbox_id, anyTeams ? 'teams' : 'email', detail);
          sent += 1;
          console.log(`status-notifier: created ping for ${item.ref} → ${detail}`);
        } else {
          const trader = matchTrader(item.recipient, traders);
          if (!trader || !trader.email) {
            await mark(item.outbox_id, 'skipped', `no contact on file for sales trader "${item.recipient ?? ''}"`);
            skipped += 1;
            continue;
          }
          const { text, subject } = traderMessage(item);
          const via = await sendToPerson({ email: trader.email, text, subject });
          if (!via) {
            failed += 1;
            console.error(`status-notifier: ${item.event} ping failed for ${trader.name} (${item.ref})`);
            continue;
          }
          await mark(item.outbox_id, via, `${trader.name} (${via})`);
          sent += 1;
          console.log(`status-notifier: ${item.event} ping for ${item.ref} → ${trader.name} (${via})`);
        }
      } catch (e) {
        // Mark failed after a send, or an unexpected error — logged loudly; the row
        // stays pending, so worst case is one duplicate ping next run.
        failed += 1;
        console.error(`status-notifier: MARK/processing failed for ${item.tab}/${item.sample_id} ${item.event}`, e);
      }
    }
    return { success: true, pending: items.length, sent, skipped, failures: failed };
  },
});
