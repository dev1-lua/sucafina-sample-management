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

// Feedback ⑦: lab location is stored as a canonical lowercase token ("westlands"/"thika") but a
// custom lab can be entered verbatim. Title-case the known tokens; leave anything else untouched.
const LOCATION_LABELS: Record<string, string> = { westlands: 'Westlands', thika: 'Thika' };
export function formatLocation(loc: unknown): string | null {
  if (loc == null || loc === '') return null;
  const s = String(loc);
  return LOCATION_LABELS[s.toLowerCase()] ?? s;
}
