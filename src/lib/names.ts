/**
 * Display name from an email when that's all the desk gave us:
 * "thomas.mueller@sucafina.com" → "Thomas Mueller", "tmueller@…" → "Tmueller".
 */
export function nameFromEmail(email: string): string {
  const local = email.trim().split('@')[0] ?? '';
  const parts = local.split(/[._\-+]+/).filter((p) => p && !/^\d+$/.test(p));
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  return parts.length ? parts.map(cap).join(' ') : local || email.trim();
}

/** Email domains that count as Sucafina-internal (mirrored in api/src/lib/roster-externals.ts). */
export const INTERNAL_EMAIL_DOMAINS = ['sucafina.com'];

/**
 * Is this a colleague's address? A CLIENT's contact (nestle.com, itochu.co.jp…) is never put on the
 * internal roster or asked for details — RC7, 2026-09-09: three customers had been saved as "traders"
 * and account managers through the loop-in question and were receiving internal status pings.
 */
export function isInternalEmail(email: string | null | undefined): boolean {
  const e = (email ?? '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 0) return false;
  const domain = e.slice(at + 1);
  return INTERNAL_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}
