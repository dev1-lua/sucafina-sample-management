// Ref → lot (group) key, mirroring api/src/lib/lots.ts `normalizeRef` + `lotRefFor` and the SQL
// `lot_ref(text)` of migration 024. A ref names the COFFEE; for a pre-shipment sample (PSS) the
// options of one contract — SSKE-104929A, SSKE-104929B … — are one group keyed by the contract
// base SSKE-104929. Every other ref is its own lot, so only SSKE strips a trailing letter.

const PSS_OPTION = /^(SSKE-\d+)[A-Z]$/;
const PSS_BASE = /^SSKE-\d+$/;

/** "type - 980" → "TYPE-980": trim, upper-case, collapse whitespace, `\s*-\s*` → "-", "PREFIX 980" → "PREFIX-980". */
export function normalizeRef(s: string | null | undefined): string {
  return (s ?? '').trim().toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/^([A-Z]+) (\d)/, '$1-$2');
}

/** The lot a ref belongs to: `SSKE-104929B` → `SSKE-104929`; anything else is its normalised self. */
export function lotRefFor(ref: string | null | undefined): string {
  return normalizeRef(ref).replace(PSS_OPTION, '$1');
}

/** True for a PSS contract base ref (`SSKE-104929`) — the row that groups the lettered options. */
export function isPssGroup(ref: string | null | undefined): boolean {
  return PSS_BASE.test(normalizeRef(ref));
}

/**
 * The option letter of a send: `option_letter` as served, else the trailing letter of the send's own
 * PSS ref (legacy rows predate the column), else null.
 */
export function optionLetterOf(send: { option_letter?: string | null; ref?: string | null }): string | null {
  return send.option_letter || PSS_OPTION.exec(normalizeRef(send.ref))?.[0]?.slice(-1) || null;
}
