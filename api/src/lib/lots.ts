import type { PoolClient } from 'pg';
import { pool } from '../db.js';

// Lots (migration 023, round 10). The desk's sample ref names the COFFEE, not the send: the same ref is
// reused when the same coffee goes out again (SL-7336 → three receivers), and different coffee must never
// share a ref (the TYPE-113 bug). `lots` is the identity — one row per (normalised) ref with the coffee it
// names — and every ref comparison goes through normalize_ref (SQL) / normalizeRef (here). The SQL
// functions in 023 mirror the three normalisers below; test/lots.test.ts pins the parity.

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
 * Lower-case; split a blend on "," or "/"; per part strip punctuation except "%", drop the noise words
 * (type sample / sample / samples / replacement), collapse whitespace; sort and re-join with " / " so a blend
 * is order-insensitive. Keeps the distinguishing letter: "TYPE SAMPLE B" → "b", "ARABICA SAMPLE B" →
 * "arabica b" — those two are meant NOT to match; the agent's confirm step decides. Modelled on
 * normalizeClientName (client-merge.ts).
 */
export function normalizeQuality(s: string | null | undefined): string {
  const parts = (s ?? '').toLowerCase().split(/[,/]/)
    .map((part) => part
      .replace(/[^\p{L}\p{N}\s%]/gu, ' ')
      .replace(/\btype sample\b/g, ' ')
      .replace(/\b(sample|samples|replacement)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean);
  return parts.sort().join(' / ');
}

const upperTrim = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();

/** The coffee a row names. Specialty: outturn|grade (fallback: normalised description|grade). Commercial: quality|blend, both normalised. */
export function coffeeKeyFor(c: Coffee): string {
  if (c.book === 'specialty') {
    const outturn = upperTrim(c.outturn);
    return outturn ? `${outturn}|${upperTrim(c.grade)}` : `${normalizeQuality(c.quality)}|${upperTrim(c.grade)}`;
  }
  return `${normalizeQuality(c.quality)}|${normalizeQuality(c.blend)}`;
}

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

/** `lot_sends` for a book table aliased `alias`: live rows on the same (normalised) ref in that table — the row itself counts. */
export function lotSendsColumn(alias: string, refCol: string, table: string): string {
  return `CASE WHEN COALESCE(btrim(${alias}.${refCol}), '') = '' THEN 1
               ELSE (SELECT count(*)::int FROM ${table} ls WHERE ls.deleted_at IS NULL AND normalize_ref(ls.${refCol}) = normalize_ref(${alias}.${refCol})) END AS lot_sends`;
}

/** `consignment_number` for a sample table aliased `alias`. */
export function consignmentNumberColumn(alias: string): string {
  return `(SELECT cn.number FROM consignments cn WHERE cn.id = ${alias}.consignment_id) AS consignment_number`;
}

// ---- reading -------------------------------------------------------------------------------------------

export async function findLot(db: Db, ref: string): Promise<Lot | null> {
  const { rows } = await db.query(`SELECT * FROM lots WHERE ref = $1`, [normalizeRef(ref)]);
  return (rows[0] as Lot | undefined) ?? null;
}

/** The most recently issued lot naming this coffee in this book (the backfill may have left several). */
async function findLotByCoffee(db: Db, book: Book, coffeeKey: string): Promise<Lot | null> {
  const { rows } = await db.query(
    `SELECT * FROM lots WHERE book = $1 AND coffee_key = $2 ORDER BY first_issued_at DESC, ref LIMIT 1`,
    [book, coffeeKey],
  );
  return (rows[0] as Lot | undefined) ?? null;
}

const SENDS_SQL = `
  SELECT 'specialty'::text AS tab, t.id, t.ref AS ref, t.description AS title, t.receiver_company AS receiver,
         t.date_on, t.status::text AS status, t.qty_grams, t.courier_norm, t.awb, t.created_at,
         (SELECT c.number FROM consignments c WHERE c.id = t.consignment_id) AS consignment_number
    FROM specialty_samples t WHERE t.deleted_at IS NULL AND normalize_ref(t.ref) = $1
  UNION ALL
  SELECT 'bulk', t.id, t.sample_ref, t.quality, t.client,
         t.date_on, t.status::text, t.qty_grams, t.courier_norm, t.awb, t.created_at,
         (SELECT c.number FROM consignments c WHERE c.id = t.consignment_id)
    FROM bulk_samples t WHERE t.deleted_at IS NULL AND normalize_ref(t.sample_ref) = $1
  ORDER BY date_on DESC NULLS LAST, created_at DESC`;

/** Live rows on this ref in both books, newest first. */
export async function liveSends(db: Db, ref: string, o: { limit: number }): Promise<Send[]> {
  const { rows } = await db.query(`${SENDS_SQL} LIMIT $2`, [normalizeRef(ref), Math.max(1, o.limit)]);
  return rows.map(({ created_at, ...r }) => r) as Send[];
}

// ---- writing -------------------------------------------------------------------------------------------

/**
 * Register a lot for `ref` unless one exists. Never overwrites: the coffee a ref names is fixed when the
 * ref is first issued. Returns the lot on file and whether this call created it.
 */
export async function registerLot(
  db: Db,
  o: Coffee & { ref: string; createdBy?: string | null },
): Promise<{ lot: Lot; created: boolean }> {
  const ref = normalizeRef(o.ref);
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

/** After a soft-delete: drop the lot when no live row in either book carries its ref any more. */
export async function releaseLotIfOrphaned(db: Db, ref: string | null | undefined): Promise<boolean> {
  const norm = normalizeRef(ref);
  if (!norm) return false;
  const { rowCount } = await db.query(
    `DELETE FROM lots l
      WHERE l.ref = $1
        AND NOT EXISTS (SELECT 1 FROM specialty_samples s WHERE s.deleted_at IS NULL AND normalize_ref(s.ref) = $1)
        AND NOT EXISTS (SELECT 1 FROM bulk_samples b WHERE b.deleted_at IS NULL AND normalize_ref(b.sample_ref) = $1)`,
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
