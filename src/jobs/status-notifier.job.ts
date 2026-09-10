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

const BOOK: Record<string, string> = { specialty: 'Specialty', bulk: 'Commercial', forwarding: 'Forwarding', client: 'Client', consignment: 'Consignment', contract: 'Contract', import: 'Import' };

// Routing sets (courier tracking, this job — Phase 5 reuses for the pss_* events, wired here so the
// routing never needs to move again). QC_AND_LOOP_EVENTS gets BOTH: the Quality team plus whoever is
// kept in the loop on the sample. Harriet (2026-09-10): the PSS reminders (14/7/0 days + weekly while
// overdue) go to QC ONLY; a twice-rejected option still reaches the account manager as well.
export const QC_EVENTS = new Set(['created', 'deleted', 'request_edited', 'pss_schedule_imported', 'pss_due_soon', 'pss_overdue']);
export const LOOP_EVENTS = new Set(['preparing', 'dispatched', 'awb_added', 'delivered']);
export const QC_AND_LOOP_EVENTS = new Set(['tracking_exception', 'pss_rejected']);

/** First occurrence per lowercased email wins; entries with no email pass through untouched (they're
 * filtered out as unreachable later) so a QC member and a loop-in sharing one inbox get pinged once. */
function dedupeByEmail<T extends { email: string | null }>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of list) {
    const key = (r.email ?? '').trim().toLowerCase();
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(r);
  }
  return out;
}

const COURIER_LABEL: Record<string, string> = { dhl: 'DHL', fedex: 'FedEx' };
const courierLabel = (c: string | null | undefined) => (c ? COURIER_LABEL[c] ?? c.toUpperCase() : 'courier');

const REASON_LABEL: Record<string, string> = {
  customs_hold: 'customs hold',
  address_problem: 'address problem',
  returned: 'returned to sender',
  refused: 'refused by receiver',
  damaged: 'damaged',
  other: 'courier exception',
};

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 10);
  }
}

function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 16).replace('T', ' ');
  }
}

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
  if (i.event === 'dispatched') {
    return {
      text: `${i.ref ?? 'Your sample'} is on its way — ${i.courier_norm ?? 'courier'}${i.awb ? ` AWB ${i.awb}` : ''}. (${label})`,
      subject: `Sample ${i.ref ?? ''}: dispatched`,
    };
  }
  // Anything not covered above (a new event reaching a version that predates its wording) still gets a
  // truthful line rather than the dispatch text — never claim a sample moved when we don't know that.
  return {
    text: `${i.ref ?? 'A sample'} was updated: ${i.event}. (${label})`,
    subject: `Sample ${i.ref ?? ''}: ${i.event}`,
  };
}

/**
 * Contracts + PSS (migration 020): the 45-day rule speaking. Payload-driven — the sweep and the status
 * machine put every number on the outbox row, so this only formats what it was handed.
 */
export function pssMessage(i: OutboxItem): { text: string; subject: string } {
  const p = i.payload ?? {};
  const ref = i.ref ?? '';
  const who = i.client_name ?? p.client_name ?? '—';
  const options = (n: number | undefined) => `${n ?? '?'} option${n === 1 ? '' : 's'}`;
  if (i.event === 'pss_due_soon') {
    const when = p.days_left === 0 ? 'TODAY' : `in ${p.days_left} days`;
    return {
      text: `PSS due ${when}: **${ref} · ${who}** ship ${shortDate(p.shipment_date)} • ${p.approved} of ${p.expected} options approved • ${options(p.missing_pss)} still to send`,
      subject: `PSS due ${when}: ${ref}`,
    };
  }
  if (i.event === 'pss_overdue') {
    return {
      text: `⚠️ PSS OVERDUE ${p.overdue_days}d: **${ref} · ${who}** ship ${shortDate(p.shipment_date)} • ${options(p.missing_pss)} still to send`,
      subject: `PSS OVERDUE ${p.overdue_days}d: ${ref}`,
    };
  }
  if (i.event === 'pss_rejected') {
    // Harriet's words: "PSS replacement rejected" — the contract is flagged AND the next letter is drawn.
    const letters = (p.failed_options ?? []).length ? `option ${p.failed_options!.join(', ')}` : `slot ${(p.failed_containers ?? []).join(', ')}`;
    const drawn = (p.replacements ?? []).length ? `; ${p.replacements!.join(', ')} drawn as the next option` : '';
    return {
      text: `❌ ${ref} · ${who}: PSS replacement rejected — ${letters}${drawn} — contract flagged until an option is approved; settle with the trader`,
      subject: `PSS replacement rejected: ${ref}`,
    };
  }
  // pss_schedule_imported
  return {
    text: `SOL schedule imported (${p.file_name ?? ref}) by ${p.actor ?? 'the desk'}: ${options(p.pss_created)} scheduled across ${(p.contracts_created ?? 0) + (p.contracts_updated ?? 0)} contracts (${p.contracts_created} new) • first due ${shortDate(p.first_due)}`,
    subject: `SOL PSS schedule imported: ${options(p.pss_created)}`,
  };
}

const PSS_EVENTS = new Set(['pss_due_soon', 'pss_overdue', 'pss_rejected', 'pss_schedule_imported']);

/** Courier tracking pings — `delivered` (loop-in) and `tracking_exception` (QC + loop-in). */
export function trackingMessage(i: OutboxItem): { text: string; subject: string } {
  const p = i.payload ?? {};
  const ref = i.ref ?? '';
  if (i.event === 'delivered') {
    return {
      text: `${ref} delivered to ${i.receiver ?? i.client_name ?? '—'} on ${shortDate(p.delivered_at)} (${courierLabel(p.courier)})${p.last_event ? ` — ${p.last_event}` : ''}`,
      subject: `Sample ${ref}: delivered`,
    };
  }
  // tracking_exception
  const reason = p.reason ?? 'other';
  return {
    text: `⚠️ ${ref} stuck: ${REASON_LABEL[reason] ?? reason} at ${p.location ?? 'unknown location'} (${courierLabel(p.courier)} AWB ${p.awb ?? '?'}) — last scan ${shortDateTime(p.last_event_at)}${p.last_event ? `: ${p.last_event}` : ''}`,
    subject: `Sample ${ref}: ${REASON_LABEL[reason] ?? reason}`,
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
  // A PSS drawn to replace one the client rejected is not a new request — say so up front, so QC reads
  // it as the follow-up it is (migration 020).
  const repl = i.payload?.replacement_of ? `REPLACEMENT PSS (for ${i.payload.replacement_of}) — ` : '';
  return {
    text: `${repl}New sample request${urgent}:\n- ${describe(i)}${people ? `\n- ${people}` : ''}${gap ? `\n- ${gap}` : ''}`,
    subject: `${repl}New sample request${urgent ? ' (URGENT)' : ''}: ${i.ref ?? i.title ?? ''}${gap ? ' — address pending' : ''}`,
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
    // The 45-day PSS rule speaks at every tick: the sweep queues D-14 / D-7 / D-0 and the weekly overdue
    // nudge (dedupe-keyed API-side, so a second pass the same day queues nothing), and the rows it wrote
    // are drained by this very run. A 404 is silent by design — an agent version can go live before
    // API 020 is deployed, and a missing route must not stop the rest of the queue.
    await apiFetch('/contracts/pss-sweep', { method: 'POST', headers: { 'x-actor': 'job:status-notifier' } }).catch((e) => {
      if ((e as { status?: number }).status !== 404) console.error('[status-notifier] pss-sweep', e);
    });
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
        const ev = item.event;
        // Recipients = QC (when the event is QC-routed or QC+loop) plus the people in the loop
        // (the client's account manager + anyone added on the sample, resolved by the API at send
        // time, migration 014) — when the event is loop-routed or QC+loop. Deduped by email so a QC
        // member who is also the account manager gets one ping, not two.
        const wantsQc = QC_EVENTS.has(ev) || QC_AND_LOOP_EVENTS.has(ev);
        const wantsLoop = LOOP_EVENTS.has(ev) || QC_AND_LOOP_EVENTS.has(ev);
        const recipients = dedupeByEmail([
          ...(wantsQc ? qc.map((t) => ({ name: t.name, email: t.email })) : []),
          ...(wantsLoop ? (item.recipients ?? []).map((r) => ({ name: r.name, email: r.email })) : []),
        ]);
        if (!recipients.length) {
          await mark(
            item.outbox_id,
            'skipped',
            !wantsLoop
              ? 'no Quality-team members with an email on file'
              : !wantsQc
                ? `no one in the loop for ${item.client_name ?? 'this sample'}: client has no account manager and no loop-in contacts`
                : `no Quality-team members and no one in the loop for ${item.client_name ?? 'this sample'}`,
          );
          skipped += 1;
          continue;
        }
        const reachable = recipients.filter((r) => r.email);
        if (!reachable.length) {
          await mark(item.outbox_id, 'skipped', `in the loop but no email on file: ${recipients.map((r) => r.name).join(', ')}`);
          skipped += 1;
          continue;
        }
        const { text, subject } =
          ev === 'created' ? qcMessage(item)
            : ev === 'delivered' || ev === 'tracking_exception' ? trackingMessage(item)
              : PSS_EVENTS.has(ev) ? pssMessage(item)
                : traderMessage(item);
        const delivered: Array<{ name: string; via: 'teams' | 'email' }> = [];
        // The QC desk mailbox is CC'd once per event — on the first email that goes out,
        // not on every recipient's copy.
        let ccSent = false;
        for (const r of reachable) {
          const via = await sendToPerson({ email: r.email!, text, subject, cc: ccSent ? [] : ccFor(r.email!) });
          if (via === 'email') ccSent = true;
          if (via) delivered.push({ name: r.name, via });
        }
        if (!delivered.length) {
          if (!EMAIL_CHANNEL_READY) {
            // Nobody warm on Teams and no email channel to fall back to — mark
            // skipped (visible, retried up to the 5-attempt cap) rather than
            // retrying forever or falsely claiming delivery.
            await mark(item.outbox_id, 'skipped', `${reachable.map((r) => r.name).join(', ')} cold on Teams, email channel not wired`);
            skipped += 1;
            continue;
          }
          // Every send failed — leave unmarked so the next run retries.
          failed += 1;
          console.error(`status-notifier: ${ev} ping failed for all recipients (${item.ref})`);
          continue;
        }
        const anyTeams = delivered.some((d) => d.via === 'teams');
        const detail = delivered.map((d) => `${d.name} (${d.via})`).join(', ') + (ccSent ? CC_NOTE : '');
        await mark(item.outbox_id, anyTeams ? 'teams' : 'email', detail);
        sent += 1;
        console.log(`status-notifier: ${ev} ping for ${item.ref} → ${detail}`);
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
