import { shortDay } from './resolve-sample';
import { lotRefFor, normalizeRef } from './normalize';

// A ref names the COFFEE (round 10): SL-7336 is one outturn+grade, TYPE-973 one type sample — the same
// ref goes on every send of that coffee; a different coffee gets a new ref. `POST /lots/resolve`
// (contracts §1) decides reuse / new / conflict; this module turns that answer into the one line the
// model echoes, and recognises the create routes' 409 when a typed ref names another coffee.

export type LotBook = 'specialty' | 'commercial';

export type Lot = {
  ref: string;
  book: LotBook;
  coffee_key: string;
  outturn: string | null;
  grade: string | null;
  quality: string | null;
  blend: string | null;
  first_issued_at: string | null;
};

export type LotSend = {
  tab: 'specialty' | 'bulk' | 'forwarding';
  id: string;
  receiver: string | null;
  date_on: string | null;
  status: string | null;
  qty_grams?: number | null;
  courier_norm?: string | null;
  awb?: string | null;
  /** PSS only: the option letter this send is (SSKE-104929C → "C"); null elsewhere. */
  option_letter?: string | null;
};

export type LotResolution = {
  action: 'reuse' | 'new' | 'conflict';
  ref: string | null;
  lot: Lot | null;
  /** Newest first, live rows only. */
  sends: LotSend[];
  reason?: string;
};

/** The coffee as typed on this request (or as a lot carries it). */
export type CoffeeInput = {
  book: LotBook;
  ref?: string | null;
  outturn?: string | null;
  grade?: string | null;
  quality?: string | null;
  blend?: string | null;
};

export function ordinal(n: number): string {
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** "17KN0076 AA" (specialty: outturn + grade, else the description) · "AB FAQ · <blend>" (commercial). */
export function coffeeLabel(c: CoffeeInput): string {
  const clean = (s: string | null | undefined) => (s ?? '').trim();
  if (c.book === 'specialty') {
    const lot = [clean(c.outturn), clean(c.grade)].filter(Boolean).join(' ');
    return lot || clean(c.quality) || '?';
  }
  return [clean(c.quality), clean(c.blend)].filter(Boolean).join(' · ') || '?';
}

/**
 * The line the model echoes inside the confirm:
 *   reuse    → "Ref: SL-7336 (same coffee — 3rd send, last to TORCH 4 Jun)"
 *              PSS group → "SSKE-104929 has options A, B; this will be C"
 *   conflict → "TYPE-113 is AB FAQ (sent to Joh Johanson 24 Jun). This is C FAQ — a different coffee, so it
 *               gets a new ref. OK, or did you mean AB FAQ?"
 *   new      → "TYPE-980 is free — I'll use it" (typed) · "ref will be issued"
 */
export function lotSay(res: LotResolution, typed: CoffeeInput): string {
  const last = res.sends[0];
  if (res.action === 'reuse') {
    const pss = pssGroupSay(res, typed);
    if (pss) return pss;
    const nth = ordinal(res.sends.length + 1);
    const tail = last ? `, last to ${last.receiver ?? '?'} ${shortDay(last.date_on)}` : '';
    return `Ref: ${res.ref ?? res.lot?.ref ?? '?'} (same coffee — ${nth} send${tail})`;
  }
  if (res.action === 'conflict') {
    const existing = res.lot ? coffeeLabel(res.lot) : 'another coffee';
    const sent = last ? ` (sent to ${last.receiver ?? '?'} ${shortDay(last.date_on)})` : '';
    return `${res.ref ?? typed.ref ?? '?'} is ${existing}${sent}. This is ${coffeeLabel(typed)} — a different coffee, so it gets a new ref. OK, or did you mean ${existing}?`;
  }
  return res.ref ? `${res.ref} is free — I'll use it` : 'ref will be issued';
}

const PSS_BASE = /^SSKE-\d+$/;
const PSS_LETTER = /^SSKE-\d+([A-Z])$/;

/**
 * A PSS ref's options are one contract group (round 10b): a reuse of `SSKE-104929` reads
 *   "SSKE-104929 has options A, B; this will be C"
 * where the letters are the group's live options and "this will be" is the letter the trader typed, else the
 * next one after the highest. Null when the ref is not a PSS group or no send carries a letter (→ plain reuse).
 */
function pssGroupSay(res: LotResolution, typed: CoffeeInput): string | null {
  const base = lotRefFor(res.ref ?? res.lot?.ref);
  if (!base || !PSS_BASE.test(base)) return null;
  const letters = [...new Set(res.sends.map((s) => (s.option_letter ?? '').trim().toUpperCase()).filter(Boolean))].sort();
  if (letters.length === 0) return null;
  const typedLetter = normalizeRef(typed.ref)?.match(PSS_LETTER)?.[1] ?? normalizeRef(res.ref)?.match(PSS_LETTER)?.[1];
  const highest = letters[letters.length - 1];
  const next = typedLetter ?? (highest < 'Z' ? String.fromCharCode(highest.charCodeAt(0) + 1) : null);
  if (!next) return null;
  return `${base} has ${letters.length === 1 ? 'option' : 'options'} ${letters.join(', ')}; this will be ${next}`;
}

/** The create routes' 409 (contracts §4): `{ error: 'ref_conflict', ref, lot, sends }` — else null. */
export function refConflict(e: unknown): { ref: string; lot: Lot | null; sends: LotSend[] } | null {
  const err = e as { status?: number; body?: unknown } | null;
  const body = err?.body as { error?: string; ref?: string; lot?: Lot | null; sends?: LotSend[] } | undefined;
  if (err?.status !== 409 || body?.error !== 'ref_conflict') return null;
  return { ref: String(body.ref ?? ''), lot: body.lot ?? null, sends: body.sends ?? [] };
}

/** The tool result a create returns instead of a row when the typed ref names another coffee. */
export function refConflictResult(conflict: { ref: string; lot: Lot | null; sends: LotSend[] }, typed: CoffeeInput) {
  return {
    created: false as const,
    ref_conflict: true as const,
    ref: conflict.ref,
    lot: conflict.lot,
    sends: conflict.sends,
    say: lotSay({ action: 'conflict', ref: conflict.ref, lot: conflict.lot, sends: conflict.sends }, typed),
    next: 'Nothing was written. Ask the trader: same coffee → create again with this ref; a different coffee → create again WITHOUT a ref.',
  };
}
