import type { ExceptionReason } from '../tracking.js';

/**
 * Shared free-text → exception-reason classifier, used by both DHL and FedEx so the
 * category rules only live in one place. Returns null when nothing specific matches —
 * callers decide their own fallback (DHL falls back to 'other'; FedEx falls back to a
 * code-derived baseline, then 'other').
 */
export function reasonFromText(text: string): ExceptionReason | null {
  if (/customs|clearance/i.test(text)) return 'customs_hold';
  if (/address/i.test(text)) return 'address_problem';
  if (/return/i.test(text)) return 'returned';
  if (/refus/i.test(text)) return 'refused';
  if (/damag/i.test(text)) return 'damaged';
  return null;
}
