import { LuaJob } from 'lua-cli';
import { apiFetch } from '../lib/api';
import { ccFor, EMAIL_CHANNEL_READY, loadTraders, sendToPerson, type TraderRow } from '../lib/notify';
import { changeAlertMessage, isChangeAlert, type OutboxItem } from '../lib/change-alerts';

// Timeline suffix when the QC desk mailbox was CC'd on an event's email (once per event).
const CC_NOTE = ' · cc Specialty QC mailbox';

// Ivo Jr. (feedback #29/#30): the Quality team hears about every sample request the
// moment it's logged in full, and the Sales Trader hears as their sample progresses
// (preparing / dispatched / AWB added). Drains the notifications_outbox queue the API
// fills in-transaction on create/PATCH — a job rather than a tool hook so dashboard
// edits notify too. Per person: warm Teams DM first, email fallback (lib/notify).
// Idempotency mirrors dispatch-notifier: /notifications/outbox-mark is stamped only
// AFTER a successful send, so a failed send self-retries next run; unresolvable
// recipients are marked 'skipped' and age out after 5 attempts (API-side cap).

const BOOK: Record<string, string> = { specialty: 'Specialty', bulk: 'Commercial', forwarding: 'Forwarding', client: 'Client', consignment: 'Consignment' };

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
  // Log-first (2026-09-08): the request is logged before the client's address exists — QC must see the
  // gap on the ping itself, and who was asked to fill it.
  const gap = !i.client_address_missing ? null
    : i.details_requested_from
      ? `⚠ No delivery address on file for ${i.client_name ?? i.receiver ?? 'the client'} — asked ${i.details_requested_from}` +
        `${i.details_requested_via ? ` (${i.details_requested_via}` : ' ('}${i.details_requested_at ? `${i.details_requested_via ? ', ' : ''}${String(i.details_requested_at).slice(0, 10)}` : ''}) · chased daily`
      : `⚠ No delivery address on file for ${i.client_name ?? i.receiver ?? 'the client'} — nobody asked yet${i.details_note ? ` (${i.logged_by ?? 'trader'}: "${i.details_note}")` : ''}`;
  return {
    text: `New sample request${urgent}:\n- ${describe(i)}${people ? `\n- ${people}` : ''}${gap ? `\n- ${gap}` : ''}`,
    subject: `New sample request${urgent ? ' (URGENT)' : ''}: ${i.ref ?? i.title ?? ''}${gap ? ' — address pending' : ''}`,
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

    // Harriet (round 6): deletions and request edits go to QC as ONE grouped message per run — sent
    // after the per-sample events below, marked row by row only after the send succeeds.
    const changes = items.filter(isChangeAlert);
    const rest = items.filter((i) => !isChangeAlert(i));
    if (changes.length) {
      try {
        if (!qc.length) {
          for (const c of changes) await mark(c.outbox_id, 'skipped', 'no Quality-team members with an email on file');
          skipped += changes.length;
        } else {
          const { text, subject } = changeAlertMessage(changes);
          const delivered: Array<{ t: TraderRow; via: 'teams' | 'email' }> = [];
          let ccSent = false;
          for (const t of qc) {
            const via = await sendToPerson({ email: t.email!, text, subject, cc: ccSent ? [] : ccFor(t.email!) });
            if (via === 'email') ccSent = true;
            if (via) delivered.push({ t, via });
          }
          if (!delivered.length) {
            failed += changes.length;
            console.error(`status-notifier: change alert failed for all QC recipients (${changes.length} rows)`);
          } else {
            const anyTeams = delivered.some((d) => d.via === 'teams');
            const detail = delivered.map((d) => `${d.t.name} (${d.via})`).join(', ') + (ccSent ? CC_NOTE : '');
            for (const c of changes) await mark(c.outbox_id, anyTeams ? 'teams' : 'email', detail);
            sent += changes.length;
            console.log(`status-notifier: change alert (${changes.length} rows) → ${detail}`);
          }
        }
      } catch (e) {
        failed += changes.length;
        console.error('status-notifier: change alert processing failed', e);
      }
    }

    for (const item of rest) {
      try {
        if (item.event === 'created') {
          if (!qc.length) {
            await mark(item.outbox_id, 'skipped', 'no Quality-team members with an email on file');
            skipped += 1;
            continue;
          }
          const { text, subject } = qcMessage(item);
          const delivered: Array<{ t: TraderRow; via: 'teams' | 'email' }> = [];
          // The QC desk mailbox is CC'd once per event — on the first email that goes out,
          // not on every recipient's copy.
          let ccSent = false;
          for (const t of qc) {
            const via = await sendToPerson({ email: t.email!, text, subject, cc: ccSent ? [] : ccFor(t.email!) });
            if (via === 'email') ccSent = true;
            if (via) delivered.push({ t, via });
          }
          if (!delivered.length) {
            if (!EMAIL_CHANNEL_READY) {
              // Nobody warm on Teams and no email channel to fall back to — mark
              // skipped (visible, retried up to the 5-attempt cap) rather than
              // retrying forever or falsely claiming delivery.
              await mark(item.outbox_id, 'skipped', 'no QC member reachable: all cold on Teams, email channel not wired');
              skipped += 1;
              continue;
            }
            // Every send failed — leave unmarked so the next run retries.
            failed += 1;
            console.error(`status-notifier: created ping failed for all QC recipients (${item.ref})`);
            continue;
          }
          const anyTeams = delivered.some((d) => d.via === 'teams');
          const detail = delivered.map((d) => `${d.t.name} (${d.via})`).join(', ') + (ccSent ? CC_NOTE : '');
          await mark(item.outbox_id, anyTeams ? 'teams' : 'email', detail);
          sent += 1;
          console.log(`status-notifier: created ping for ${item.ref} → ${detail}`);
        } else {
          // Status pings go to the people in the loop: the client's account manager plus
          // anyone added on the sample (resolved by the API at send time, migration 014).
          const recipients = item.recipients ?? [];
          if (!recipients.length) {
            await mark(
              item.outbox_id,
              'skipped',
              `no one in the loop for ${item.client_name ?? 'this sample'}: client has no account manager and no loop-in contacts`,
            );
            skipped += 1;
            continue;
          }
          const reachable = recipients.filter((r) => r.email);
          if (!reachable.length) {
            await mark(
              item.outbox_id,
              'skipped',
              `in the loop but no email on file: ${recipients.map((r) => r.name).join(', ')}`,
            );
            skipped += 1;
            continue;
          }
          const { text, subject } = traderMessage(item);
          const delivered: Array<{ name: string; via: 'teams' | 'email' }> = [];
          let ccSent = false;
          for (const r of reachable) {
            const via = await sendToPerson({ email: r.email!, text, subject, cc: ccSent ? [] : ccFor(r.email!) });
            if (via === 'email') ccSent = true;
            if (via) delivered.push({ name: r.name, via });
          }
          if (!delivered.length) {
            if (!EMAIL_CHANNEL_READY) {
              await mark(item.outbox_id, 'skipped', `${reachable.map((r) => r.name).join(', ')} cold on Teams, email channel not wired`);
              skipped += 1;
              continue;
            }
            failed += 1;
            console.error(`status-notifier: ${item.event} ping failed for everyone in the loop (${item.ref})`);
            continue;
          }
          const anyTeams = delivered.some((d) => d.via === 'teams');
          const detail = delivered.map((d) => `${d.name} (${d.via})`).join(', ') + (ccSent ? CC_NOTE : '');
          await mark(item.outbox_id, anyTeams ? 'teams' : 'email', detail);
          sent += 1;
          console.log(`status-notifier: ${item.event} ping for ${item.ref} → ${detail}`);
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
