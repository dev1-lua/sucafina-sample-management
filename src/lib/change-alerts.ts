// Change alerts to the Quality team (Harriet, round 6 — migration 017): the outbox item shape the
// status-notifier drains, and the ONE grouped message it sends per run for deletions / request edits.

export type OutboxItem = {
  outbox_id: string;
  tab: 'specialty' | 'bulk' | 'forwarding' | 'client' | 'consignment' | 'contract' | 'import';
  sample_id: string;
  event:
    | 'created' | 'preparing' | 'dispatched' | 'awb_added' | 'deleted' | 'request_edited'
    | 'delivered' | 'tracking_exception'
    | 'pss_due_soon' | 'pss_overdue' | 'pss_rejected' | 'pss_schedule_imported'
    | string;
  recipient: string | null;
  ref: string | null;
  title: string | null;
  receiver: string | null;
  status: string | null;
  courier_norm: string | null;
  awb: string | null;
  qty_grams: number | null;
  priority: string | null;
  requested_by: string | null;
  logged_by: string | null;
  client_name: string | null;
  created_at: string;
  /** Who is kept in the loop (migration 014): the client's account manager + per-sample loop-ins. */
  recipients: { id: string; name: string; email: string | null }[];
  /** Log-first (migration 016): the client has no delivery address on file (+ who was asked). */
  client_address_missing?: boolean;
  details_requested_from?: string | null;
  details_requested_at?: string | null;
  details_requested_via?: string | null;
  details_note?: string | null;
  /** Change alerts (migration 017). */
  dedupe_key?: string;
  /** Courier tracking (migration 019): carried on `delivered` / `tracking_exception` outbox rows. */
  payload?: {
    changes?: Record<string, { from: unknown; to: unknown }>;
    merged_into?: string;
    merged_into_name?: string;
    courier?: 'dhl' | 'fedex' | null;
    awb?: string | null;
    /** A courier exception's category, or — on a replacement draw — the client's rejection reason. */
    reason?: 'customs_hold' | 'address_problem' | 'returned' | 'refused' | 'damaged' | 'other' | string | null;
    last_event?: string | null;
    last_event_at?: string | null;
    location?: string | null;
    delivered_at?: string | null;
    /** Contracts + PSS (migration 020): the pss_* rows on tabs `contract` / `import`. */
    contract_number?: string | null;
    client_name?: string | null;
    shipment_date?: string | null;
    pss_due_date?: string | null;
    days_left?: number;
    overdue_days?: number;
    missing_pss?: number;
    approved?: number;
    expected?: number;
    failed_containers?: number[];
    /** Migration 021: the rejected option letters per flagged slot, and the refs drawn to replace them. */
    failed_options?: string[];
    replacements?: string[];
    file_name?: string | null;
    contracts_created?: number;
    contracts_updated?: number;
    pss_created?: number;
    first_due?: string | null;
    actor?: string | null;
    /** A PSS drawn to replace a rejected one carries the ref it replaces. */
    replacement_of?: string | null;
  } | null;
  actor?: string | null;
};

export const isChangeAlert = (i: OutboxItem) => i.event === 'deleted' || i.event === 'request_edited';

const BOOK: Record<string, string> = { specialty: 'Specialty', bulk: 'Commercial', forwarding: 'Forwarding' };

const FIELD_LABEL: Record<string, string> = {
  qty_grams: 'qty', quality: 'quality', description: 'description', grade: 'grade', client_id: 'client',
  receiver_company: 'receiver', country: 'country', priority: 'priority', shipment_month: 'shipment month',
  contract_number: 'contract', blend: 'blend', phyto_cert: 'phyto', sample_type_norm: 'type', status: 'status',
  coffee_quality: 'quality', origin: 'origin', id_number: 'ID number',
};

/** "Ivo (dashboard)", "Ivo Jr. (chat)", "dashboard (name not set)", "status-notifier (job)". */
export function actorLabel(actor: string | null | undefined): string {
  const raw = (actor ?? '').trim();
  const i = raw.indexOf(':');
  const surface = i < 0 ? raw : raw.slice(0, i);
  const name = i < 0 ? '' : raw.slice(i + 1).trim();
  const where = surface === 'agent' ? 'chat' : surface || 'api';
  if (!name || name === 'chat') return surface === 'dashboard' ? 'dashboard (name not set)' : where;
  return `${name} (${where})`;
}

function fmtValue(v: unknown, field: string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'qty_grams' && typeof v === 'number') return v >= 1000 ? `${v / 1000} kg` : `${v} g`;
  if (field === 'client_id') return 'changed';
  return String(v);
}

function nairobiTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

function line(i: OutboxItem): string {
  const by = `by ${actorLabel(i.actor)} at ${nairobiTime(i.created_at)}`;
  if (i.event === 'deleted') {
    if (i.tab === 'client') return `• DELETED client "${i.ref ?? '?'}"${i.payload?.merged_into_name ? ` (merged into ${i.payload.merged_into_name})` : ''} — ${by}`;
    if (i.tab === 'consignment') return `• DELETED consignment ${i.ref ?? '?'} — ${by}`;
    const bits = [i.title, i.receiver ? `→ ${i.receiver}` : null, i.qty_grams ? `${i.qty_grams}g` : null, BOOK[i.tab]].filter(Boolean).join(' • ');
    return `• DELETED ${i.ref ?? '(no ref)'} — ${bits} — ${by}`;
  }
  const changes = i.payload?.changes ?? {};
  const diff = Object.entries(changes)
    .map(([f, c]) => (f === 'client_id' ? 'client changed' : `${FIELD_LABEL[f] ?? f} ${fmtValue(c.from, f)} → ${fmtValue(c.to, f)}`))
    .join('; ');
  const bits = [i.title, i.receiver ? `→ ${i.receiver}` : null, BOOK[i.tab]].filter(Boolean).join(' • ');
  return `• EDITED ${i.ref ?? '(no ref)'} — ${bits} — ${diff || 'request changed'} — ${by}`;
}

/** One grouped QC message for this run's deletions + edits. */
export function changeAlertMessage(items: OutboxItem[]): { text: string; subject: string } {
  const deleted = items.filter((i) => i.event === 'deleted').length;
  const edited = items.length - deleted;
  const when = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date());
  const parts = [deleted ? `${deleted} deleted` : null, edited ? `${edited} edited` : null].filter(Boolean).join(', ');
  return {
    text: `Sample request changes (${items.length}) — ${when}\n${items.map(line).join('\n')}`,
    subject: `Sample request changes: ${parts}`,
  };
}
