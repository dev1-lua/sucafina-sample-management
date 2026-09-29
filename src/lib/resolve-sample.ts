import { apiFetch } from './api';
import { isSendId, normalizeRef, TAB_ENDPOINT, type Tab } from './normalize';

// A ref names the COFFEE, not a parcel (round 10): SL-7336 is one outturn+grade and is reused on every
// send, so several live rows can share it. Every ref-taking tool resolves through here — the one place
// that knows how to pick a send, and the one wording for "which receiver?". A Send ID (SS-1234, round 11)
// names ONE row: it resolves through the same endpoint to exactly one candidate and never needs a receiver.

/** One live send of a ref, as `GET /samples/resolve` lists it (contracts §5). */
export type SampleCandidate = {
  tab: Tab;
  id: string;
  /** The row's own Send ID, `SS-1234` — unique to this send, unlike the ref. */
  send_id?: string | null;
  ref: string;
  title: string | null;
  receiver: string | null;
  status: string | null;
  date_on: string | null;
  consignment_number: string | null;
  awb: string | null;
  courier_norm: string | null;
};

export type ResolvedSample = {
  tab: Tab;
  id: string;
  send_id?: string | null;
  ref: string;
  receiver: string | null;
  /** Present when the pick was a judgement call (one open send, or the newest of several) — echo it. */
  note?: string;
};

/** A send still on its way: anything not delivered / closed / cancelled. */
const CLOSED = new Set(['delivered', 'closed', 'cancelled']);
export const isOpenSend = (s: Pick<SampleCandidate, 'status'>) => !CLOSED.has((s.status ?? '').toLowerCase());

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-06-04" → "4 Jun" — the desk's shorthand for a send date. */
export function shortDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '?';
  return `${Number(m[3])} ${MONTH_ABBR[Number(m[2]) - 1] ?? '?'}`;
}

/** "SS-1234 → TORCH (4 Jun, delivered)" — the Send ID leads when the row carries one, so the person can name that send back. */
export const describeSend = (s: SampleCandidate) => `${s.send_id ? `${s.send_id} ` : ''}→ ${s.receiver ?? '?'} (${shortDay(s.date_on)}, ${s.status ?? '?'})`;

/**
 * One option of a PSS contract group (round 10b), as "where is SSKE-104929?" lists them:
 *   "SSKE-104929 · option A → CK Corporation, dispatched 12 Sep (DHL 123)"
 * The parenthesis carries the courier and AWB when there are any; a send without a letter reads "option ?".
 */
export function describeOption(
  base: string,
  s: { option_letter: string | null; receiver: string | null; status: string | null; date_on: string | null; courier_norm: string | null; awb: string | null; send_id?: string | null },
): string {
  const courier = s.courier_norm ? s.courier_norm.replace(/_/g, ' ').toUpperCase() : null;
  const via = [courier, s.awb].filter(Boolean).join(' ');
  const sendId = s.send_id ? ` · ${s.send_id}` : '';
  return `${base} · option ${s.option_letter ?? '?'}${sendId} → ${s.receiver ?? '?'}, ${s.status ?? '?'} ${shortDay(s.date_on)}${via ? ` (${via})` : ''}`;
}

/**
 * Every live send of a ref (newest first), optionally narrowed by tab and/or receiver (ILIKE server-side).
 * A Send ID (`SS-1234`) goes down the same endpoint and comes back as the one row that carries it — the
 * receiver narrowing is dropped for it, since the id already names one send and a mistyped receiver must
 * not turn a hit into "no sample".
 */
export async function resolveSampleCandidates(ref: string, opts: { tab?: Tab; receiver?: string } = {}): Promise<SampleCandidate[]> {
  const wanted = normalizeRef(ref);
  if (!wanted) throw new Error('Pass a sample ref or Send ID to identify the sample.');
  const p = new URLSearchParams({ ref: wanted });
  if (opts.tab) p.set('tab', opts.tab);
  if (opts.receiver?.trim() && !isSendId(wanted)) p.set('receiver', opts.receiver.trim());
  const res = await apiFetch(`/samples/resolve?${p}`);
  return (res?.candidates ?? []) as SampleCandidate[];
}

/**
 * Resolve a ref to ONE send. 0 → throws. 1 → that one. Several: with a receiver, the newest of the
 * narrowed list (note says so); without one, the single open send when exactly one is open (note says
 * so), else a model-facing "which receiver?" listing every send.
 * A Send ID (`SS-1234`) is one row by construction: it is returned as-is and never asks "which receiver?".
 */
export async function resolveSampleByRef(ref: string, opts: { tab?: Tab; receiver?: string } = {}): Promise<ResolvedSample> {
  const wanted = normalizeRef(ref) ?? '';
  const cands = await resolveSampleCandidates(ref, opts);
  const pick = (s: SampleCandidate, note?: string): ResolvedSample => ({ tab: s.tab, id: String(s.id), send_id: s.send_id ?? null, ref: s.ref ?? wanted, receiver: s.receiver ?? null, ...(note ? { note } : {}) });
  if (cands.length === 0) {
    throw new Error(`No sample with ${isSendId(wanted) ? 'Send ID' : 'ref'} ${wanted}${opts.receiver && !isSendId(wanted) ? ` sent to "${opts.receiver}"` : ''} — check ${isSendId(wanted) ? 'the Send ID' : 'the ref'} with search_samples.`);
  }
  if (cands.length === 1) return pick(cands[0]!);
  if (isSendId(wanted)) {
    // The API answers a Send ID with exactly one row; should it ever list more, the one carrying that id wins.
    return pick(cands.find((s) => (s.send_id ?? '').toUpperCase() === wanted) ?? cands[0]!);
  }
  if (opts.receiver?.trim()) {
    const s = cands[0]!;
    return pick(s, `${cands.length} sends of ${wanted} match "${opts.receiver.trim()}" — picked the newest, → ${s.receiver ?? '?'} (${shortDay(s.date_on)})`);
  }
  const open = cands.filter(isOpenSend);
  if (open.length === 1) {
    const s = open[0]!;
    const older = cands.length - 1;
    return pick(s, `picked the open send → ${s.receiver ?? '?'}; ${wanted} has ${older} older send${older === 1 ? '' : 's'}`);
  }
  throw new Error(`${wanted} has ${cands.length} sends: ${cands.map(describeSend).join(' · ')}. Which receiver?`);
}

export const sampleEndpoint = (tab: Tab) => `/${TAB_ENDPOINT[tab]}`;
