import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';

// Lots (migration 023, round 10). The desk's sample ref names the COFFEE, not the send: the same ref is
// reused when the same coffee goes out again (SL-7336 → three receivers), and different coffee must never
// share a ref (the TYPE-113 bug). `lots` is the identity — one row per lot ref with the coffee it names —
// and every ref comparison goes through normalize_ref (SQL) / normalizeRef (here). The SQL functions in
// 023/024 mirror the normalisers below; test/lots.test.ts pins the parity.
//
// Round 10b (Harriet, 2026-09-23): a pre-shipment sample ref is SSKE-<contract digits><option letter>
// (SSKE-104929A, B, C …) and the desk wants the options of one contract under ONE group. The LOT of an SSKE
// ref is therefore its base, SSKE-<digits> (lotRefFor / SQL lot_ref); the sample row keeps its lettered ref.
// Options of one contract are one group: a typed option of an existing group is a reuse, never a conflict.

type Db = Pick<PoolClient, 'query'> | typeof pool;

export type Book = 'specialty' | 'commercial';
export type SendTab = 'specialty' | 'bulk';

export type Lot = {
  ref: string;
  book: Book;
  coffee_key: string;
  outturn: string | null;
  grade: string | null;
  quality: string | null;
  blend: string | null;
  first_issued_at: string;
  created_by: string | null;
};

export type Send = {
  tab: SendTab;
  id: string;
  ref: string;
  /** PSS option letter: the row's column, else the trailing letter of its SSKE ref (legacy rows carry none). */
  option_letter: string | null;
  title: string | null;
  receiver: string | null;
  date_on: string | null;
  status: string;
  qty_grams: number | null;
  courier_norm: string | null;
  awb: string | null;
  consignment_number: string | null;
};

export type Coffee = {
  book: Book;
  outturn?: string | null;
  grade?: string | null;
  quality?: string | null;
  blend?: string | null;
};

// ---- normalisers (mirrored in SQL by migration 023) ---------------------------------------------------

/** "type - 980" → "TYPE-980": trim, upper-case, collapse whitespace, `\s*-\s*` → "-", "PREFIX 980" → "PREFIX-980". */
export function normalizeRef(s: string | null | undefined): string {
  return (s ?? '').trim().toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/^([A-Z]+) (\d)/, '$1-$2');
}

/**
 * The lot a ref belongs to. An SSKE ref with one trailing option letter (`SSKE-104929A`, or the sheet's
 * `SSKE-104929 A` / `SSKE 104929 A`, which normalize_ref leaves with a space) keys on its base
 * `SSKE-104929` — the contract. Every other ref is its own lot. Mirrored by SQL lot_ref() (migration 024).
 */
export function lotRefFor(ref: string | null | undefined): string {
  return normalizeRef(ref).replace(/^(SSKE-\d+) ?[A-Z]$/, '$1');
}

/** Is this (normalised) ref a PSS group — the base or an option of one? Those never conflict on quality text. */
const isPssGroupRef = (ref: string): boolean => /^SSKE-\d+$/.test(lotRefFor(ref));

/** The option letter an SSKE ref carries, when it does ("SSKE-104929 B" → "B"). Mirrored by SQL ref_option_letter(). */
export function optionLetterOfRef(ref: string | null | undefined): string | null {
  return /^SSKE-\d+ ?([A-Z])$/.exec(normalizeRef(ref))?.[1] ?? null;
}

// Words that never distinguish one coffee from another in the desk's quality column (round 10b softening,
// Harriet 2026-09-23): the sample words, certification chatter, process, origin. Grade tokens (aa, ab, c,
// pb, e, tt, t, aaa, "aa plus"), screen sizes ("sc 15", "screen 18") and percentages are deliberately kept.
const QUALITY_NOISE = new Set([
  'type', 'sample', 'samples', 'replacement',
  'ra', 'eudr', 'certificate', 'certified', 'compliance', 'washed', 'process', 'arabica', 'kenya',
]);
// Legacy-data repair, not a fuzzy matcher: the imported sheet holds the literal "inders FAQ RA EUDR compliance"
// for a truncated "Grinders" (SSKE-97389, Ahold). Documented here and in migration 024; nothing else is aliased.
const QUALITY_ALIASES: Record<string, string> = { inders: 'grinders' };

/**
 * Lower-case; split a blend on "," or "/"; per part: punctuation (incl. "-", "_" inside a token) → space,
 * cut any "same coffee as …" tail, apply the legacy alias, drop the noise words, singularise a trailing "s" on
 * a word of ≥ 5 letters (grinders → grinder; faqs, plus and glass stay), collapse whitespace; sort the parts
 * and re-join with " / " so a blend is order-insensitive. "TYPE SAMPLE B" = "ARABICA SAMPLE B" = "b" (the desk:
 * the same coffee); "b" ≠ "c", "aa faq" ≠ "ab faq", "aa plus" ≠ "aa". Mirrored by SQL normalize_quality().
 */
export function normalizeQuality(s: string | null | undefined): string {
  const parts = (s ?? '').toLowerCase().split(/[,/]/)
    .map((part) => part
      .replace(/[^\p{L}\p{N}\s%]/gu, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\bsame coffee as\b.*$/, ' ')
      .split(' ')
      .map((t) => QUALITY_ALIASES[t] ?? t)
      .filter((t) => t && !QUALITY_NOISE.has(t))
      .map((t) => t.replace(/^([a-z]{3,}[a-rt-z])s$/, '$1'))
      .join(' '))
    .filter(Boolean);
  return parts.sort().join(' / ');
}

const upperTrim = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();

/**
 * The quality part of a coffee key. A quality the normaliser reduces to nothing ("Kenya", "Washed",
 * "Sample", "same coffee as TYPE-903") keys on its raw text, lower-cased and whitespace-collapsed — so those
 * stay distinct coffees instead of all collapsing onto the empty key and becoming one. A genuinely empty
 * quality stays "" (and findLotByCoffee never matches it). Mirrored by SQL quality_key() (migration 024).
 */
export function qualityKey(s: string | null | undefined): string {
  return normalizeQuality(s) || (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The coffee a row names. Specialty: outturn|grade (fallback: description key|grade). Commercial: quality key|normalised blend. */
export function coffeeKeyFor(c: Coffee): string {
  if (c.book === 'specialty') {
    const outturn = upperTrim(c.outturn);
    return outturn ? `${outturn}|${upperTrim(c.grade)}` : `${qualityKey(c.quality)}|${upperTrim(c.grade)}`;
  }
  return `${qualityKey(c.quality)}|${normalizeQuality(c.blend)}`;
}

/** A key whose quality part is empty ("|", "|AA") names no coffee: nothing may be matched to it. */
const namesACoffee = (coffeeKey: string): boolean => !coffeeKey.startsWith('|');

/** Human label for a lot's coffee — used in resolve reasons and conflict messages. */
export function describeCoffee(c: Coffee): string {
  if (c.book === 'specialty') {
    const head = (c.outturn ?? '').trim() || (c.quality ?? '').trim();
    return [head, (c.grade ?? '').trim()].filter(Boolean).join(' ') || '(no coffee given)';
  }
  const blend = (c.blend ?? '').trim();
  return `${(c.quality ?? '').trim() || '(no quality given)'}${blend ? ` / ${blend}` : ''}`;
}

// ---- SQL fragments shared by the list endpoints / view readers ---------------------------------------

/** `lot_sends` for a book table aliased `alias`: live rows in the same LOT (lot_ref) in that table — the row itself counts. */
export function lotSendsColumn(alias: string, refCol: string, table: string): string {
  return `CASE WHEN COALESCE(btrim(${alias}.${refCol}), '') = '' THEN 1
               ELSE (SELECT count(*)::int FROM ${table} ls WHERE ls.deleted_at IS NULL AND lot_ref(ls.${refCol}) = lot_ref(${alias}.${refCol})) END AS lot_sends`;
}

/** `consignment_number` for a sample table aliased `alias`. */
export function consignmentNumberColumn(alias: string): string {
  return `(SELECT cn.number FROM consignments cn WHERE cn.id = ${alias}.consignment_id) AS consignment_number`;
}

// ---- reading -------------------------------------------------------------------------------------------

/** The lot this ref belongs to — an SSKE option resolves to its contract's base lot. */
export async function findLot(db: Db, ref: string): Promise<Lot | null> {
  const { rows } = await db.query(`SELECT * FROM lots WHERE ref = $1`, [lotRefFor(ref)]);
  return (rows[0] as Lot | undefined) ?? null;
}

/** The most recently issued lot naming this coffee in this book (the backfill may have left several). */
export async function findLotByCoffee(db: Db, book: Book, coffeeKey: string): Promise<Lot | null> {
  if (!namesACoffee(coffeeKey)) return null;
  // A PSS contract group (SSKE-<digits>) is never proposed by coffee: its refs are contract-derived and belong to
  // that contract's client only — a type/offer sample of the same quality gets its own SL/TYPE ref.
  const { rows } = await db.query(
    `SELECT * FROM lots WHERE book = $1 AND coffee_key = $2 AND ref !~ '^SSKE-\\d+$' ORDER BY first_issued_at DESC, ref LIMIT 1`,
    [book, coffeeKey],
  );
  return (rows[0] as Lot | undefined) ?? null;
}

const SENDS_SQL = `
  SELECT 'specialty'::text AS tab, t.id, t.ref AS ref, COALESCE(t.option_letter, ref_option_letter(t.ref)) AS option_letter,
         t.description AS title, t.receiver_company AS receiver,
         t.date_on, t.status::text AS status, t.qty_grams, t.courier_norm, t.awb, t.created_at,
         (SELECT c.number FROM consignments c WHERE c.id = t.consignment_id) AS consignment_number
    FROM specialty_samples t WHERE t.deleted_at IS NULL AND lot_ref(t.ref) = $1
  UNION ALL
  SELECT 'bulk', t.id, t.sample_ref, COALESCE(t.option_letter, ref_option_letter(t.sample_ref)), t.quality, t.client,
         t.date_on, t.status::text, t.qty_grams, t.courier_norm, t.awb, t.created_at,
         (SELECT c.number FROM consignments c WHERE c.id = t.consignment_id)
    FROM bulk_samples t WHERE t.deleted_at IS NULL AND lot_ref(t.sample_ref) = $1
  ORDER BY date_on DESC NULLS LAST, created_at DESC`;

/** Live rows in this ref's LOT in both books (an SSKE option → every option of its contract), newest first. */
export async function liveSends(db: Db, ref: string, o: { limit: number }): Promise<Send[]> {
  const { rows } = await db.query(`${SENDS_SQL} LIMIT $2`, [lotRefFor(ref), Math.max(1, o.limit)]);
  return rows.map(({ created_at, ...r }) => r) as Send[];
}

/** The option letters live in this ref's group (column, else the letter in the ref), both books, distinct, A→Z. */
export async function groupOptionLetters(db: Db, ref: string): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT letter FROM (
       SELECT COALESCE(option_letter, ref_option_letter(ref)) AS letter
         FROM specialty_samples WHERE deleted_at IS NULL AND lot_ref(ref) = $1
       UNION ALL
       SELECT COALESCE(option_letter, ref_option_letter(sample_ref))
         FROM bulk_samples WHERE deleted_at IS NULL AND lot_ref(sample_ref) = $1
     ) x WHERE letter IS NOT NULL ORDER BY letter`,
    [lotRefFor(ref)],
  );
  return rows.map((r) => String(r.letter));
}

// ---- writing -------------------------------------------------------------------------------------------

/**
 * Register a lot for `ref` (an SSKE option registers its contract's base) unless one exists. Never
 * overwrites: the coffee a ref names is fixed when the ref is first issued. Returns the lot on file and
 * whether this call created it.
 */
export async function registerLot(
  db: Db,
  o: Coffee & { ref: string; createdBy?: string | null },
): Promise<{ lot: Lot; created: boolean }> {
  const ref = lotRefFor(o.ref);
  const { rows } = await db.query(
    `INSERT INTO lots (ref, book, coffee_key, outturn, grade, quality, blend, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (ref) DO NOTHING
     RETURNING *`,
    [ref, o.book, coffeeKeyFor(o), o.outturn ?? null, o.grade ?? null, o.quality ?? null, o.blend ?? null, o.createdBy ?? null],
  );
  if (rows[0]) return { lot: rows[0] as Lot, created: true };
  const existing = await findLot(db, ref);
  if (!existing) throw new Error(`lot ${ref} vanished between insert and read`);
  return { lot: existing, created: false };
}

/**
 * A typed ref must never be re-issued by the counter: move the prefix's counter past it (never backwards).
 * Only the counter-shaped refs (SL / TYPE / SSKE + digits) touch a counter; anything else returns false.
 */
export async function claimRef(db: Db, ref: string): Promise<boolean> {
  const m = /^(SL|TYPE|SSKE)-(\d+)$/.exec(normalizeRef(ref));
  if (!m) return false;
  const { rowCount } = await db.query(
    `UPDATE ref_counters SET next_val = GREATEST(next_val, $2::int + 1) WHERE prefix = $1`,
    [m[1], Number(m[2])],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * The create routes' lot write, on the insert's own transaction. A TYPED ref registers its lot (or must
 * match the one on file — the route pre-checked with resolveLot; a concurrent claim in between is the
 * only way to get here with a different coffee) and moves the counter past its number. A counter-issued or
 * contract-derived ref registers its lot if missing and never conflicts; nor does any SSKE ref, typed or
 * not — the options of one contract are one group whatever their quality text says.
 * `reused` = the ref already named this coffee (a re-send of the same lot / another option of the group).
 */
export async function attachLot(
  client: Db,
  o: Coffee & { ref: string; typed: boolean; createdBy: string },
): Promise<{ reused: boolean }> {
  const { lot, created } = await registerLot(client, o);
  if (o.typed) {
    if (!created && !isPssGroupRef(o.ref) && lot.coffee_key !== coffeeKeyFor(o)) {
      throw new HttpError(409, 'ref_conflict', { ref: lot.ref, lot });
    }
    await claimRef(client, o.ref);
  }
  return { reused: !created };
}

/** Live rows in this ref's lot in one book table — the create responses' `lot_sends`. */
export async function countLotSends(db: Db, table: string, refCol: string, ref: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM ${table} WHERE deleted_at IS NULL AND lot_ref(${refCol}) = $1`,
    [lotRefFor(ref)],
  );
  return Number(rows[0].n);
}

/** After a soft-delete: drop the lot when no live row in either book belongs to it any more. */
export async function releaseLotIfOrphaned(db: Db, ref: string | null | undefined): Promise<boolean> {
  const norm = lotRefFor(ref);
  if (!norm) return false;
  const { rowCount } = await db.query(
    `DELETE FROM lots l
      WHERE l.ref = $1
        AND NOT EXISTS (SELECT 1 FROM specialty_samples s WHERE s.deleted_at IS NULL AND lot_ref(s.ref) = $1)
        AND NOT EXISTS (SELECT 1 FROM bulk_samples b WHERE b.deleted_at IS NULL AND lot_ref(b.sample_ref) = $1)`,
    [norm],
  );
  return (rowCount ?? 0) > 0;
}

// ---- resolve (contracts §1) ----------------------------------------------------------------------------

export type ResolveInput = Coffee & { ref?: string | null; sample_type?: string | null };

export type Resolution = {
  action: 'reuse' | 'new' | 'conflict';
  ref: string | null;
  lot: Lot | null;
  sends: Send[];
  reason: string;
};

const SENDS_MAX = 20;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Pure read: what a create with this ref/coffee would do.
 *   typed ref + lot with the same coffee     → reuse    (ref = typed)
 *   typed ref + lot with a different coffee  → conflict (lot = the existing one, sends = its sends)
 *   typed SSKE option + its contract's lot   → reuse    (ref = typed; the group is the contract — never a conflict)
 *   typed ref + no lot                       → new      (ref = typed; the create claims it)
 *   no ref + a lot with this coffee, this book → reuse  (ref = the lot's)
 *   no ref + nothing                         → new, ref null
 */
export async function resolveLot(db: Db, input: ResolveInput): Promise<Resolution> {
  const key = coffeeKeyFor(input);
  const typed = normalizeRef(input.ref);
  if (typed) {
    const lot = await findLot(db, typed);
    if (!lot) return { action: 'new', ref: typed, lot: null, sends: [], reason: `${typed} is not in use yet; it will be claimed for this coffee.` };
    const sends = await liveSends(db, typed, { limit: SENDS_MAX });
    if (isPssGroupRef(typed)) {
      const letters = await groupOptionLetters(db, typed);
      const note = lot.coffee_key === key ? '' : ` Note: the group is on file as ${describeCoffee(lot)}; this send says ${describeCoffee(input)}.`;
      return {
        action: 'reuse', ref: typed, lot, sends,
        reason: `${lot.ref} is the contract group; ${letters.length ? `options ${letters.join(', ')}` : plural(sends.length, 'send')} so far.${note}`,
      };
    }
    if (lot.coffee_key === key) {
      return { action: 'reuse', ref: typed, lot, sends, reason: `${typed} already names this coffee (${plural(sends.length, 'send')}); the new send reuses it.` };
    }
    return {
      action: 'conflict', ref: typed, lot, sends,
      reason: `${typed} already names a different coffee — ${describeCoffee(lot)} (${plural(sends.length, 'send')}). Different coffee needs its own ref.`,
    };
  }
  const lot = await findLotByCoffee(db, input.book, key);
  if (!lot) return { action: 'new', ref: null, lot: null, sends: [], reason: 'No ref names this coffee yet; a new one will be issued.' };
  const sends = await liveSends(db, lot.ref, { limit: SENDS_MAX });
  return { action: 'reuse', ref: lot.ref, lot, sends, reason: `This coffee already has ref ${lot.ref} (${plural(sends.length, 'send')}).` };
}
