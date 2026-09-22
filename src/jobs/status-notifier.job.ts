import { LuaJob } from 'lua-cli';
import { apiFetch } from '../lib/api';
import { autoLoopIns, ccFor, EMAIL_CHANNEL_READY, loadTraders, sendToPerson, type TraderRow } from '../lib/notify';
import { changeAlertMessage, isChangeAlert, type OutboxItem } from '../lib/change-alerts';
import { bookListUrl } from '../lib/links';

// Timeline suffix when the QC mailboxes (lib/notify NOTIFY_CC) were CC'd on an event's email — once per
// event, or once per grouped order message.
const CC_NOTE = ' · QC mailboxes copied';

// Ivo Jr. (feedback #29/#30): the Quality team hears about every sample request the
// moment it's logged in full, and the people in the loop hear as the sample progresses
// (preparing / dispatched / AWB added / delivered). The loop = the client's account
// manager + per-sample loop-ins (resolved by the API, migration 014) + the row's Sales
// Trader and logger (matched against the roster here — lifecycle sketch 2026-09-14: the
// AWB ping goes back to the person who asked). Drains the notifications_outbox queue the
// API fills in-transaction on create/PATCH — a job rather than a tool hook so dashboard
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

// Every courier_norm value (lib/normalize COURIERS) spelled the way the desk says it — never "RIDER".
const COURIER_LABEL: Record<string, string> = {
  dhl: 'DHL', fedex: 'FedEx', ups: 'UPS', rider: 'rider', hand_delivery: 'hand delivery',
  client_pickup: 'client pickup', wells_fargo: 'Wells Fargo', other: 'courier',
};
export const courierLabel = (c: string | null | undefined) => (c ? COURIER_LABEL[c] ?? c : 'courier');

const REASON_LABEL: Record<string, string> = {
  customs_hold: 'customs hold',
  address_problem: 'address problem',
  returned: 'returned to sender',
  refused: 'refused by receiver',
  damaged: 'damaged',
  other: 'courier exception',
};

// Our own month names: `Intl` with month:'short' renders September as "Sept" on current ICU, and the
// desk's own shorthand (and every other date in these messages) is three letters — "9 Sep 2026".
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The instant, read in Nairobi time, as plain numbers — or null when it is not a date at all. */
function nairobiParts(iso: string): { d: number; m: number; y: number; hh: string; mm: string } | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const [d, m, y] = [Number(get('day')), Number(get('month')), Number(get('year'))];
  if (!d || !m || !y) return null;
  return { d, m, y, hh: get('hour'), mm: get('minute') };
}

/** "9 Sep 2026" */
function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const p = nairobiParts(String(iso));
    return p ? `${p.d} ${MONTH_ABBR[p.m - 1]} ${p.y}` : String(iso).slice(0, 10);
  } catch {
    return String(iso).slice(0, 10);
  }
}

/** "9 Sep 11:22" — a courier scan, where the year is noise and the time is the point. */
function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const p = nairobiParts(String(iso));
    return p ? `${p.d} ${MONTH_ABBR[p.m - 1]} ${p.hh}:${p.mm}` : String(iso).slice(0, 16).replace('T', ' ');
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

/**
 * The status pings in the sketch's words (2026-09-14): "hey — your sample abc for CLIENT has an AWB,
 * it'll be on its way soon". Exported for the unit tests.
 */
export function traderMessage(i: OutboxItem): { text: string; subject: string } {
  const label = describe(i);
  const ref = i.ref ?? 'your sample';
  const what = `${ref} (${i.title ?? '?'}) for ${i.client_name ?? i.receiver ?? '?'}`;
  const courier = courierLabel(i.courier_norm);
  // "On its way": the dispatch itself, or an AWB typed after the parcel already left — never "soon" then.
  const onItsWay = `${what} is on its way — ${courier}${i.awb ? ` AWB ${i.awb}` : ', no AWB yet'}.`;
  if (i.event === 'preparing') {
    return {
      text: `Your sample ${i.ref ?? ''} (${i.title ?? '?'} → ${i.receiver ?? '?'}) is being prepared by the lab.`,
      subject: `Sample ${i.ref ?? ''}: being prepared`,
    };
  }
  if (i.event === 'awb_added') {
    const left = i.status === 'dispatched' || i.status === 'delivered' || i.status === 'results_in';
    return {
      text: left ? onItsWay : `Your sample ${what} has a ${courier} AWB ${i.awb ?? '?'} — it'll be on its way soon.`,
      subject: `Sample ${i.ref ?? ''}: AWB added`,
    };
  }
  if (i.event === 'dispatched') {
    return { text: onItsWay, subject: `Sample ${i.ref ?? ''}: dispatched` };
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
  // Every number here comes off the outbox payload the sweep wrote; a row queued by an older API still
  // formats as "? of ?" rather than "undefined of undefined".
  const num = (n: number | undefined) => (n == null ? '?' : String(n));
  if (i.event === 'pss_due_soon') {
    const when = p.days_left === 0 ? 'TODAY' : p.days_left == null ? 'soon' : `in ${p.days_left} days`;
    return {
      text: `PSS due ${when}: **${ref} · ${who}** ship ${shortDate(p.shipment_date)} • ${num(p.approved)} of ${num(p.expected)} options approved • ${options(p.missing_pss)} still to send`,
      subject: `PSS due ${when}: ${ref}`,
    };
  }
  if (i.event === 'pss_overdue') {
    return {
      text: `⚠️ PSS OVERDUE ${num(p.overdue_days)}d: **${ref} · ${who}** ship ${shortDate(p.shipment_date)} • ${options(p.missing_pss)} still to send`,
      subject: `PSS OVERDUE ${num(p.overdue_days)}d: ${ref}`,
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
    text: `SOL schedule imported (${p.file_name ?? ref}) by ${p.actor ?? 'the desk'}: ${options(p.pss_created)} scheduled across ${(p.contracts_created ?? 0) + (p.contracts_updated ?? 0)} contracts (${num(p.contracts_created)} new) • first due ${shortDate(p.first_due)}`,
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

/** "logged by Gloria for Ivo" */
function peopleLine(i: OutboxItem): string | null {
  const people = [i.logged_by ? `logged by ${i.logged_by}` : null,
                  i.requested_by && i.requested_by !== i.logged_by ? `for ${i.requested_by}` : null]
    .filter(Boolean).join(' ');
  return people || null;
}

// Log-first (2026-09-08): the request is logged before the client's address exists — QC must see the
// gap on the ping itself, and who was asked to fill it.
function gapLine(i: OutboxItem): string | null {
  if (!i.client_address_missing) return null;
  return i.details_requested_from
    ? `⚠ No delivery address on file for ${i.client_name ?? i.receiver ?? 'the client'} — asked ${i.details_requested_from}` +
      `${i.details_requested_via ? ` (${i.details_requested_via}` : ' ('}${i.details_requested_at ? `${i.details_requested_via ? ', ' : ''}${String(i.details_requested_at).slice(0, 10)}` : ''}) · chased daily`
    : `⚠ No delivery address on file for ${i.client_name ?? i.receiver ?? 'the client'} — nobody asked yet${i.details_note ? ` (${i.logged_by ?? 'trader'}: "${i.details_note}")` : ''}`;
}

/** "2026-09-22" as the Nairobi calendar reads it. */
function nairobiDate(iso: string | Date): string | null {
  const p = nairobiParts(iso instanceof Date ? iso.toISOString() : String(iso));
  return p ? `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : null;
}

/** The client row was born with this request (payload flag), or was created today by the Nairobi calendar. */
function isNewClient(i: OutboxItem, now: Date): boolean {
  if (i.payload?.client_created === true) return true;
  const created = i.client_created_at ? nairobiDate(i.client_created_at) : null;
  return !!created && created === nairobiDate(now);
}

/** "Client: EDMAX — Jane · jane@edmax.co.ke · +254 …", flagged 🆕 when the client is new today (contracts §8). */
function clientLine(i: OutboxItem, now: Date): string | null {
  const name = i.client_name ?? i.receiver;
  if (!name) return null;
  const flag = isNewClient(i, now) ? '🆕 NEW CLIENT (added today) ' : '';
  return `${flag}Client: ${name} — ${i.client_contact ?? '—'} · ${i.client_email ?? 'no email on file'} · ${i.client_phone ?? '—'}`;
}

/** "Type: type · Country: Kenya" */
function typeLine(i: OutboxItem): string | null {
  if (!i.sample_type_norm && !i.country) return null;
  return `Type: ${i.sample_type_norm ?? '—'} · Country: ${i.country ?? '—'}`;
}

/** The single-sample QC ping: today's text plus the client / type lines. Exported for the unit tests. */
export function qcMessage(i: OutboxItem, opts: { now?: Date } = {}): { text: string; subject: string } {
  const now = opts.now ?? new Date();
  const urgent = i.priority === 'urgent' ? ' 🔴 URGENT' : '';
  const gap = gapLine(i);
  // A PSS drawn to replace one the client rejected is not a new request — say so up front, so QC reads
  // it as the follow-up it is (migration 020).
  const repl = i.payload?.replacement_of ? `REPLACEMENT PSS (for ${i.payload.replacement_of}) — ` : '';
  const lines = [describe(i), peopleLine(i), clientLine(i, now), typeLine(i), gap].filter(Boolean);
  return {
    text: `${repl}New sample request${urgent}:\n${lines.map((l) => `- ${l}`).join('\n')}`,
    subject: `${repl}New sample request${urgent ? ' (URGENT)' : ''}: ${i.ref ?? i.title ?? ''}${gap ? ' — address pending' : ''}`,
  };
}

/** The order a `created` row belongs to: its consignment, else the request (logger + client). Null = never grouped. */
function orderKey(i: OutboxItem): string | null {
  const cn = i.payload?.consignment_id ?? i.consignment_id ?? i.payload?.consignment_number ?? i.consignment_number;
  if (cn) return `cn:${cn}`;
  const client = i.client_id ?? i.client_name;
  if (!client) return null;
  return `req:${i.logged_by ?? ''}|${client}`;
}

/**
 * One request to one client = ONE QC ping (round 10): the pending `created` rows of this run grouped by
 * order — `payload.consignment_id`, falling back to logger + client when the sends were not grouped into
 * a consignment. Rows that cannot be keyed stay on their own. Order of first appearance is kept.
 */
export function groupCreated(items: OutboxItem[]): OutboxItem[][] {
  const groups: OutboxItem[][] = [];
  const byKey = new Map<string, OutboxItem[]>();
  for (const i of items) {
    const key = orderKey(i);
    if (!key) { groups.push([i]); continue; }
    let g = byKey.get(key);
    if (!g) { g = []; byKey.set(key, g); groups.push(g); }
    g.push(i);
  }
  return groups;
}

/**
 * The grouped "new order" ping — one message for the 3 samples of CN-1012 instead of three. Subject
 * "New sample request (3): CN-1012 · EDMAX". Exported for the unit tests.
 */
export function qcOrderMessage(items: OutboxItem[], opts: { now?: Date } = {}): { text: string; subject: string } {
  const now = opts.now ?? new Date();
  const first = items[0]!;
  const cn = first.payload?.consignment_number ?? first.consignment_number ?? null;
  const client = first.client_name ?? first.receiver ?? 'the client';
  const anyUrgent = items.some((i) => i.priority === 'urgent');
  const urgent = anyUrgent ? ' 🔴 URGENT' : '';
  const n = items.length;
  const header = cn ? `New order ${cn} for ${client}${urgent} — ${n} samples:` : `New sample request (${n}) for ${client}${urgent} — ${n} samples:`;
  // The gap is per client, so one line covers the order — the row that names who was asked wins.
  const gapRow = items.find((i) => i.client_address_missing && i.details_requested_from) ?? items.find((i) => i.client_address_missing);
  const gap = gapRow ? gapLine(gapRow) : null;
  const link = cn && first.tab in BOOK_PATH ? bookListUrl(first.tab as 'specialty' | 'bulk' | 'forwarding', { consignment: cn }) : null;
  const lines = [
    ...items.map((i) => `${describe(i)}${i.priority === 'urgent' ? ' 🔴' : ''}`),
    peopleLine(first),
    clientLine(first, now),
    typeLine(first),
    gap,
    link,
  ].filter(Boolean);
  return {
    text: `${header}\n${lines.map((l) => `- ${l}`).join('\n')}`,
    subject: `New sample request (${n})${anyUrgent ? ' (URGENT)' : ''}: ${cn ? `${cn} · ` : ''}${client}${gap ? ' — address pending' : ''}`,
  };
}

const BOOK_PATH = { specialty: true, bulk: true, forwarding: true } as const;

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

    // Round 10: a request of several coffees to one client is ONE order and ONE QC ping — the pending
    // `created` rows are grouped by order (groupCreated) and go out as one message; every other event is
    // its own unit. All rows of a unit share one send, one via/detail, one CC.
    const createdRows = rest.filter((i) => i.event === 'created');
    const units: OutboxItem[][] = [...groupCreated(createdRows), ...rest.filter((i) => i.event !== 'created').map((i) => [i])];

    for (const unit of units) {
      const item = unit[0]!;
      const label = unit.length > 1 ? `${unit.length} rows (${unit.map((i) => i.ref).join(', ')})` : String(item.ref);
      const markAll = async (via: 'teams' | 'email' | 'skipped', detail: string | null) => {
        for (const i of unit) await mark(i.outbox_id, via, detail);
      };
      try {
        const ev = item.event;
        // Recipients = QC (when the event is QC-routed or QC+loop) plus the people in the loop
        // — when the event is loop-routed or QC+loop: the client's account manager + anyone added
        // on the sample (resolved by the API at send time, migration 014) + the row's Sales Trader
        // and logger (matched against the roster here). Deduped by email so a QC member who is
        // also the account manager, or a trader who logged their own request, gets one ping.
        const wantsQc = QC_EVENTS.has(ev) || QC_AND_LOOP_EVENTS.has(ev);
        const wantsLoop = LOOP_EVENTS.has(ev) || QC_AND_LOOP_EVENTS.has(ev);
        const auto = wantsLoop ? autoLoopIns([item.requested_by, item.logged_by], traders) : { hits: [], unresolved: [] };
        const recipients = dedupeByEmail([
          ...(wantsQc ? qc.map((t) => ({ name: t.name, email: t.email })) : []),
          ...(wantsLoop ? (item.recipients ?? []).map((r) => ({ name: r.name, email: r.email })) : []),
          ...auto.hits.map((t) => ({ name: t.name, email: t.email })),
        ]);
        if (!recipients.length) {
          const missed = auto.unresolved.length ? `; ${auto.unresolved.join(' / ')}` : '';
          await markAll(
            'skipped',
            !wantsLoop
              ? 'no Quality-team members with an email on file'
              : !wantsQc
                ? `no one in the loop for ${item.client_name ?? 'this sample'}: client has no account manager and no loop-in contacts${missed}`
                : `no Quality-team members and no one in the loop for ${item.client_name ?? 'this sample'}${missed}`,
          );
          skipped += unit.length;
          continue;
        }
        const reachable = recipients.filter((r) => r.email);
        if (!reachable.length) {
          await markAll('skipped', `in the loop but no email on file: ${recipients.map((r) => r.name).join(', ')}`);
          skipped += unit.length;
          continue;
        }
        const { text, subject } =
          ev === 'created' ? (unit.length > 1 ? qcOrderMessage(unit) : qcMessage(item))
            : ev === 'delivered' || ev === 'tracking_exception' ? trackingMessage(item)
              : PSS_EVENTS.has(ev) ? pssMessage(item)
                : traderMessage(item);
        const delivered: Array<{ name: string; via: 'teams' | 'email' }> = [];
        // The QC mailboxes are CC'd once per unit — on the first email that goes out,
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
            await markAll('skipped', `${reachable.map((r) => r.name).join(', ')} cold on Teams, email channel not wired`);
            skipped += unit.length;
            continue;
          }
          // Every send failed — leave unmarked so the next run retries.
          failed += unit.length;
          console.error(`status-notifier: ${ev} ping failed for all recipients (${label})`);
          continue;
        }
        const anyTeams = delivered.some((d) => d.via === 'teams');
        const detail = delivered.map((d) => `${d.name} (${d.via})`).join(', ') + (ccSent ? CC_NOTE : '');
        await markAll(anyTeams ? 'teams' : 'email', detail);
        sent += unit.length;
        console.log(`status-notifier: ${ev} ping for ${label} → ${detail}`);
      } catch (e) {
        // Mark failed after a send, or an unexpected error — logged loudly; the rows
        // stay pending, so worst case is one duplicate ping next run.
        failed += unit.length;
        console.error(`status-notifier: MARK/processing failed for ${item.tab}/${item.sample_id} ${item.event} (${label})`, e);
      }
    }
    return { success: true, pending: items.length, sent, skipped, failures: failed };
  },
});
