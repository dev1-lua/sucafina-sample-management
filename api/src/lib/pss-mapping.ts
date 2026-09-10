import XLSX from 'xlsx';

// Reading Harriet's SOL PSS schedule (phase 5, round 6). Every desk exports that report with slightly
// different column titles — "Ctrs" one month, "No of Containers" the next — and the banner rows above
// the table move around. Everything in this file is PURE: headers in, a column map out; a cell in, a
// date out. The database work lives in pss-import.ts, so the mapping rules can be pinned down without
// one, and a preview can be re-derived from the stored rows without touching the source file again.

export const CANONICAL_FIELDS = [
  'contract_number', 'client_name', 'quality', 'destination', 'shipment_date',
  'containers', 'pss_expected', 'container_no', 'notes',
  // Harriet's pending-dispatch sheet (2026-09-10): "Quantity PER SAMPLE" ("3x600grams" = three lettered
  // options of 600 g) and the client's PO reference.
  'qty_per_sample', 'po_ref',
] as const;
export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

/** Column titles seen on real SOL exports. Matched on the NORMALISED text, so "Contract #" ≡ "contract". */
export const DEFAULT_SYNONYMS: Record<CanonicalField, string[]> = {
  contract_number: ['contract', 'contract no', 'contract number', 'contract #', 'sales contract', 'so no', 'ctr'],
  client_name: ['client', 'buyer', 'customer', 'counterparty', 'receiver'],
  quality: ['quality', 'description', 'coffee', 'product', 'mark'],
  destination: ['destination', 'country', 'port', 'pod', 'discharge'],
  shipment_date: ['shipment date', 'ship date', 'etd', 'shipment period', 'shipment', 'delivery date', 'ship by'],
  containers: ['containers', 'ctrs', 'cntr', 'fcl', 'no of containers', 'container qty'],
  pss_expected: ['pss', 'pss qty', 'no of pss', 'samples'],
  container_no: ['container no', 'container #', 'ctr no'],
  notes: ['notes', 'remarks', 'comments'],
  qty_per_sample: ['quantity per sample', 'qty per sample', 'quantity', 'sample quantity', 'sample size', 'qty', 'grams per sample', 'weight per sample'],
  po_ref: ['po ref', 'po', 'po number', 'po no', 'purchase order', 'client po', 'client ref'],
};

/** Lower-case, underscores and punctuation to spaces, whitespace collapsed. "  PSS_qty " → "pss qty". */
export function normHeader(h: unknown): string {
  if (h == null) return '';
  return String(h)
    .toLowerCase()
    .replace(/_+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const tokens = (s: string): string[] => (s === '' ? [] : s.split(' '));

/** |A ∩ B| / |A ∪ B| over the header's words — "Shipment Period 2026" ≈ "shipment period" at 0.67. */
function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / (A.size + B.size - shared);
}

// Built once: normalised synonym → the field that claims it. First field wins a duplicate, but the
// table is written so no two fields normalise onto the same text (a unit test holds that line).
const BY_SYNONYM: Map<string, CanonicalField> = (() => {
  const m = new Map<string, CanonicalField>();
  for (const field of CANONICAL_FIELDS) {
    for (const syn of DEFAULT_SYNONYMS[field]) {
      const n = normHeader(syn);
      if (!m.has(n)) m.set(n, field);
    }
  }
  return m;
})();

/**
 * Header row → { canonical field: column index }. Three passes, strongest first, so a weaker rule can
 * never steal a column a stronger one wanted: the caller's own `override` (field → the header text it
 * lives under), then an exact synonym, then token overlap of at least a half. A column serves ONE field
 * and a field takes ONE column; whatever is left over comes back in `unmapped` for the preview to show.
 */
export function matchHeaders(
  headers: unknown[],
  override?: Partial<Record<CanonicalField, string>>,
): { mapping: Partial<Record<CanonicalField, number>>; unmapped: string[] } {
  const texts = headers.map((h) => (h == null ? '' : String(h).trim()));
  const norms = headers.map(normHeader);
  const mapping: Partial<Record<CanonicalField, number>> = {};
  const taken = new Set<number>();
  const claim = (field: CanonicalField, i: number) => {
    if (mapping[field] !== undefined || taken.has(i)) return;
    mapping[field] = i;
    taken.add(i);
  };

  for (const field of CANONICAL_FIELDS) {
    const wanted = override?.[field];
    if (!wanted) continue;
    const n = normHeader(wanted);
    const i = norms.findIndex((h, idx) => h !== '' && h === n && !taken.has(idx));
    if (i >= 0) claim(field, i);
  }
  norms.forEach((n, i) => {
    if (n === '' || taken.has(i)) return;
    const field = BY_SYNONYM.get(n);
    if (field) claim(field, i);
  });
  norms.forEach((n, i) => {
    if (n === '' || taken.has(i)) return;
    const words = tokens(n);
    let best: { field: CanonicalField; score: number } | null = null;
    for (const field of CANONICAL_FIELDS) {
      if (mapping[field] !== undefined) continue;
      for (const syn of DEFAULT_SYNONYMS[field]) {
        const score = jaccard(words, tokens(normHeader(syn)));
        if (score >= 0.5 && (best === null || score > best.score)) best = { field, score };
      }
    }
    if (best) claim(best.field, i);
  });

  return { mapping, unmapped: texts.filter((t, i) => t !== '' && !taken.has(i)) };
}

/**
 * Which row is the header? The SOL export carries a title and an export date above the table, and the
 * agent must not have to count them. The first of the first ten rows that maps three or more columns is
 * it; -1 means this is not a schedule at all (the route answers 422).
 */
export function detectHeaderRow(rows: unknown[][]): number {
  const limit = Math.min(rows.length, 10);
  for (let i = 0; i < limit; i++) {
    if (Object.keys(matchHeaders(rows[i] ?? []).mapping).length >= 3) return i;
  }
  return -1;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);
const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const monthByName = (word: string): number | null => {
  const w = word.toLowerCase();
  const i = MONTH_NAMES.findIndex((m) => m === w || m.slice(0, 3) === w.slice(0, 3));
  // "sept" is the one abbreviation that is four letters; the slice(0,3) test already covers it.
  return i >= 0 && w.length >= 3 ? i + 1 : null;
};
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2999;

export type ParsedDate = { date: string | null; precision: 'day' | 'month' | null; error?: string };
/** The one problem this parser can report; the preview copies it onto the row. */
const unparseable = (): ParsedDate => ({ date: null, precision: null, error: 'unparseable shipment date' });

/**
 * Every shape the shipment column arrives in: an Excel serial (what a real .xlsx holds), a JS Date, the
 * three typed forms (20/10/2026, 5.11.2026, 2026-11-05 — day first, as Kenya and Europe write them),
 * and the month-only ones the traders use when the vessel is not fixed yet ("Sep-26"), which become the
 * 1st of that month and are flagged in the preview so nobody mistakes the day for a promise.
 */
export function parseShipmentDate(v: unknown): ParsedDate {
  if (v == null) return { date: null, precision: null };

  // SheetJS builds cellDates values with new Date(y, m-1, d) — local midnight — so read them locally.
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return unparseable();
    return { date: isoDate(v.getFullYear(), v.getMonth() + 1, v.getDate()), precision: 'day' };
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return unparseable();
    const p = XLSX.SSF.parse_date_code(v);
    if (!p || !valid(p.y, p.m, p.d)) return unparseable();
    return { date: isoDate(p.y, p.m, p.d), precision: 'day' };
  }

  const s = String(v).trim();
  if (s === '') return { date: null, precision: null };

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valid(y, mo, d) ? { date: isoDate(y, mo, d), precision: 'day' } : unparseable();
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), fullYear(Number(m[3]))];
    return valid(y, mo, d) ? { date: isoDate(y, mo, d), precision: 'day' } : unparseable();
  }
  // Month only, in the three ways it is written: 09/2026, 2026-09, Sep-26 / September 2026.
  m = s.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const [mo, y] = [Number(m[1]), Number(m[2])];
    return valid(y, mo, 1) ? { date: isoDate(y, mo, 1), precision: 'month' } : unparseable();
  }
  m = s.match(/^(\d{4})[/.-](\d{1,2})$/);
  if (m) {
    const [y, mo] = [Number(m[1]), Number(m[2])];
    return valid(y, mo, 1) ? { date: isoDate(y, mo, 1), precision: 'month' } : unparseable();
  }
  m = s.match(/^([A-Za-z]{3,9})[\s./-]*'?(\d{2,4})$/);
  if (m) {
    const mo = monthByName(m[1]);
    const y = fullYear(Number(m[2]));
    if (mo && valid(y, mo, 1)) return { date: isoDate(y, mo, 1), precision: 'month' };
  }
  return unparseable();
}

/** "2", 2, " 3 ", "2 x 20ft" → a whole number; anything without digits → null. */
export function parseIntCell(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  const s = String(v).trim().replace(/,/g, '');
  if (s === '') return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Math.trunc(Number(m[0])) : null;
}

/**
 * "4x1kg", "3x600grams", "2x500 grams", "2 × 300 g" → { options, grams }; a bare "600 g" / "1.5kg" / 600 →
 * grams with options null (the sheet's other columns say how many). Anything else → null.
 */
export function parseQtyPerSample(v: unknown): { options: number | null; grams: number } | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? { options: null, grams: Math.round(v) } : null;
  const s = String(v).trim().toLowerCase().replace(/,/g, '.');
  if (s === '') return null;
  const m = s.match(/^(?:(\d+)\s*[x×*]\s*)?(\d+(?:\.\d+)?)\s*(kgs?|kilos?|kilograms?|g|gr|gms?|grams?)?$/);
  if (!m) return null;
  const n = Number(m[2]);
  const grams = /^k/.test(m[3] ?? 'g') ? Math.round(n * 1000) : Math.round(n);
  if (!(grams > 0)) return null;
  return { options: m[1] ? Number(m[1]) : null, grams };
}

/** "October 2026" — what the sample books print in their shipment_month column. */
export function monthLabel(isoDay: string): string | null {
  const m = isoDay.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const name = MONTH_NAMES[Number(m[2]) - 1];
  return name ? `${name[0].toUpperCase()}${name.slice(1)} ${m[1]}` : null;
}

/** shipment_date − 45 days, the PSS deadline. Computed here only for the preview; the column is generated. */
export function dueDateFrom(isoDay: string | null): string | null {
  if (!isoDay) return null;
  const m = isoDay.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - 45 * 86400000;
  const d = new Date(t);
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
