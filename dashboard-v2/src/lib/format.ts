// Display formatters shared across tab column configs.

/**
 * Feedback ⑨ (Bernard: kg / Muki: grams). Quantity is stored canonically in grams (`qty_grams`);
 * this renders it in the friendlier unit — kilograms once it reaches 1 kg (e.g. 1000 → "1 kg",
 * 1500 → "1.5 kg"), grams below that (e.g. "300 g"). Returns null when there's no numeric value so
 * the caller can fall back to the raw `qty` text (or CellValue's em-dash).
 */
export function formatQty(grams: unknown): string | null {
  if (grams == null || grams === '') return null;
  const g = Number(grams);
  if (!Number.isFinite(g)) return null;
  if (g >= 1000) {
    // toFixed(3) then parseFloat drops trailing zeros: 1 → "1", 1.5 → "1.5", 1.25 → "1.25".
    return `${parseFloat((g / 1000).toFixed(3))} kg`;
  }
  return `${g} g`;
}

/** Short absolute date for inline copy ("asked Ivo on Sep 3, 2026") — the same shape the
 * Timeline uses beyond its relative window. Null for empty/unparseable input. */
export function formatShortDate(iso: unknown): string | null {
  if (typeof iso !== 'string' || iso.trim() === '') return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Whole days from today to a plain `YYYY-MM-DD` date — negative once it is past (PSS due dates,
 * migration 020). Both ends are pinned to UTC noon so a timezone offset can never shift the count
 * by a day. Null for empty/unparseable input.
 */
export function daysUntil(dateStr: unknown): number | null {
  if (typeof dateStr !== 'string' || dateStr.trim() === '') return null;
  const due = Date.parse(`${dateStr.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(due)) return null;
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return Math.round((due - today) / 86_400_000);
}

// Feedback ⑦: lab location is stored as a canonical lowercase token ("westlands"/"thika") but a
// custom lab can be entered verbatim. Title-case the known tokens; leave anything else untouched.
const LOCATION_LABELS: Record<string, string> = { westlands: 'Westlands', thika: 'Thika' };
export function formatLocation(loc: unknown): string | null {
  if (loc == null || loc === '') return null;
  const s = String(loc);
  return LOCATION_LABELS[s.toLowerCase()] ?? s;
}
