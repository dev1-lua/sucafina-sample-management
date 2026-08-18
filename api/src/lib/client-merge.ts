// Client name normalization for duplicate detection (feedback #27 — "Paulig" vs "Gustav Paulig Ltd (NEW) Jan 23").
// Shared by GET /clients/:id/merge-candidates; the agent and dashboard consume that endpoint rather than
// re-implementing the rules.

const LEGAL_SUFFIXES = [
  'ltd', 'limited', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'plc',
  'gmbh', 'ag', 'sa', 'sas', 'sarl', 'srl', 'spa', 'bv', 'nv', 'oy', 'oyj', 'ab', 'as', 'aps',
  'kk', 'pty', 'pte', 'kft', 'zrt', 'sl', 'lda', 'ltda', 'ug', 'ohg', 'kg', 'eg', 'ev',
];
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december';

/**
 * Lower-case, strip punctuation, drop legal-form / "(new)" suffix words, drop dates ("Jan 23", "2023",
 * "01/2023"), collapse whitespace. "Gustav Paulig Ltd (NEW) Jan 23" → "gustav paulig".
 * Deliberately does NOT strip leading given-names, so "Paulig" ≠ "gustav paulig" — those are surfaced
 * by the ILIKE fallback in the candidates query, not by equality.
 */
export function normalizeClientName(name: string): string {
  let s = (name ?? '').toLowerCase();
  s = s.replace(new RegExp(`\\b(${MONTHS})\\.?\\s*'?\\d{2,4}\\b`, 'g'), ' ');   // Jan 23 / sept'24
  s = s.replace(/\b\d{1,2}[\/.-]\d{2,4}\b/g, ' ');                                 // 01/2023
  s = s.replace(/\b(19|20)\d{2}\b/g, ' ');                                          // 2023
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');                                          // punctuation → space
  const words = s.split(/\s+/).filter(Boolean);
  // Strip suffix words from the END only, so "co" inside "Coffee Co" is dropped but "Co-op Ltd" keeps
  // its core; also strip "(new)"-style markers anywhere since they carry no identity.
  const kept = words.filter((w) => w !== 'new' && w !== 'old');
  while (kept.length > 1 && LEGAL_SUFFIXES.includes(kept[kept.length - 1])) kept.pop();
  return kept.join(' ').trim();
}

/** Internal Sucafina/Kenyacof offices — never merged with external clients (mirrors src/lib/client-guard.ts in the agent). */
export function isInternalOffice(name?: string | null): boolean {
  return /\b(sucafina|kenyacof)\b/i.test(name ?? '');
}
