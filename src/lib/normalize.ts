/**
 * Shared data-in normalization helpers for the three sample tables
 * (specialty_samples, bulk_samples, forwarding_samples).
 *
 * Grounded in docs/data-dictionary.md §5 (controlled vocabularies) and §9
 * (normalization rules). Keeping this in one place means every create/update
 * tool normalizes couriers, countries, sample types, and AWBs the same way.
 */

export const SAMPLE_TYPES = [
  'offer',
  'type',
  'pss',
  'woc',
  'retention',
  'flavor_mapping',
  'marketing',
  'calibration',
  'other',
] as const;
export type SampleType = (typeof SAMPLE_TYPES)[number];

export const COURIERS = [
  'dhl',
  'fedex',
  'ups',
  'rider',
  'hand_delivery',
  'client_pickup',
  'other',
] as const;
export type Courier = (typeof COURIERS)[number];

export const TABS = ['specialty', 'bulk', 'forwarding'] as const;
export type Tab = (typeof TABS)[number];

/** REST path segment for each table, per api/src/routes/*. */
export const TAB_ENDPOINT: Record<Tab, string> = {
  specialty: 'specialty-samples',
  bulk: 'bulk-samples',
  forwarding: 'forwarding-samples',
};

/** Sensible qty defaults by sample type (data-dictionary §5.6 + spec §6.2/6.3). */
export const DEFAULT_QTY_GRAMS: Partial<Record<SampleType, number>> = {
  offer: 200,
  type: 300,
  pss: 1000,
};

// ---- Courier (data-dictionary §5.1) --------------------------------------

const COURIER_MAP: Record<string, Courier> = {
  dhl: 'dhl',
  fedex: 'fedex',
  fedx: 'fedex',
  ups: 'ups',
  kiptoo: 'rider',
  rider: 'rider',
  hd: 'hand_delivery',
  hby: 'hand_delivery', // "H/D" after stripping non-alpha
  byhand: 'hand_delivery',
  handdelivery: 'hand_delivery',
  pickedbyclient: 'client_pickup',
  clientpickup: 'client_pickup',
  wellsfargo: 'other',
  fargo: 'other',
  sgskenya: 'other',
};

/** Case-insensitive, whitespace-collapsing map to the canonical courier_t enum. Unknown non-empty input -> 'other'. */
export function normalizeCourier(raw?: string | null): Courier | undefined {
  if (!raw || !raw.trim()) return undefined;
  const key = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (COURIER_MAP[key]) return COURIER_MAP[key];
  if ((COURIERS as readonly string[]).includes(key)) return key as Courier;
  return 'other';
}

// ---- Country (data-dictionary §5.2) --------------------------------------

const COUNTRY_MAP: Record<string, string> = {
  usa: 'USA',
  us: 'USA',
  unitedstates: 'USA',
  unitedstatesofamerica: 'USA',
  uk: 'United Kingdom',
  unitedkingdom: 'United Kingdom',
  china: 'China',
  kenya: 'Kenya',
  skorea: 'South Korea',
  southkorea: 'South Korea',
  netherlands: 'Netherlands',
  switzerland: 'Switzerland',
  sweden: 'Sweden',
  belgium: 'Belgium',
  germany: 'Germany',
  japan: 'Japan',
  rwanda: 'Rwanda',
  burundi: 'Burundi',
  uganda: 'Uganda',
};

function titleCase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Canonical = Title Case, with explicit merges for known acronym/variant countries. */
export function normalizeCountry(raw?: string | null): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const key = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
  return COUNTRY_MAP[key] ?? titleCase(raw);
}

// ---- Sample type (data-dictionary §5.3) ----------------------------------

/**
 * Maps free chat text ("PSS June Shipment", "Type Sample", "offer") to the
 * canonical sample_type_t enum. PSS shipment-month/replacement modifiers
 * aren't columns in the new schema, so callers should fold that detail into
 * `comments` if it matters (see callers in the create tools).
 */
export function normalizeSampleType(raw?: string | null): SampleType | undefined {
  if (!raw || !raw.trim()) return undefined;
  const s = raw.trim().toLowerCase();
  if ((SAMPLE_TYPES as readonly string[]).includes(s)) return s as SampleType;
  if (s.includes('pss') || s.includes('pre-shipment') || s.includes('preshipment') || s.includes('pre shipment')) return 'pss';
  if (s.includes('offer')) return 'offer';
  if (s.includes('type')) return 'type';
  if (s.includes('woc') || s.includes('world of coffee')) return 'woc';
  if (s.includes('retention')) return 'retention';
  if (s.includes('flavor') || s.includes('flavour')) return 'flavor_mapping';
  if (s.includes('market')) return 'marketing';
  if (s.includes('calibrat')) return 'calibration';
  return 'other';
}

// ---- Lab location (migration 007, feedback ⑦) ----------------------------
// The QC labs Muki named: Westlands and Thika. Stored as free text so a new lab can appear
// without a schema change, but known variants collapse to a canonical lowercase token
// (matching the courier/sample_type convention) so filtering/display stay consistent.
export const LOCATIONS = ['westlands', 'thika'] as const;
const LOCATION_MAP: Record<string, string> = {
  westlands: 'westlands',
  westlandslab: 'westlands',
  thika: 'thika',
  thikalab: 'thika',
};
export function normalizeLocation(raw?: string | null): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const key = raw.trim().toLowerCase().replace(/[^a-z]/g, '');
  return LOCATION_MAP[key] ?? raw.trim(); // unknown labs kept verbatim
}

/** Pulls a bare shipment month (Title Case) out of free text like "PSS June Shipment" → "June". */
export function extractShipmentMonth(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : undefined;
}

/** Extracts a PSS shipment-month + replacement-flag note from free text, e.g. "PSS June Shipment(replacement)". */
export function extractPssNote(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const month = raw.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i);
  const replacement = /replacement/i.test(raw);
  if (!month && !replacement) return undefined;
  const bits = [];
  if (month) bits.push(`${month[1]} shipment`);
  if (replacement) bits.push('replacement');
  return `PSS — ${bits.join(', ')}`;
}

// ---- AWB (data-dictionary §9 rule 1) -------------------------------------

/** Store as text, digits only — strips everything non-digit, keeps as string to preserve leading zeros. */
export function normalizeAwb(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, '');
  return digits || undefined;
}
