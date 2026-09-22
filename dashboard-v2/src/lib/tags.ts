// Twenty-flavored ~10-color tag system. Each slot returns a soft-bg/saturated-text
// class pair tuned for both themes, independent of the neutral --* token vars.
//
// Contrast validated with the dataviz skill's validator (WCAG text contrast,
// `contrast()` export of scripts/validate_palette.js): every text/background pairing
// below clears >=4.5:1 in both light (700-on-100) and dark (300-on-500/20%-composited)
// modes -- most land between 6:1 and 9:1. The stricter bare-color CVD-separation
// check (meant for unlabeled chart marks) flags a sub-floor deuteranopia collision
// between blue and violet, and generally low chroma across the dark-mode pastel-300
// tints; an exhaustive re-assignment search found no swap that clears the floor
// without breaking the dark-mode ramp elsewhere (a structural property of this
// muted badge ramp, not the label assignment). <StatusBadge> always renders the
// humanized text label unconditionally -- identity is never carried by color alone --
// which is exactly the mandatory secondary encoding the skill requires here.
const PALETTE = {
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  red: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  purple: 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  teal: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  pink: 'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300',
  orange: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
} as const;

type Color = keyof typeof PALETTE;

export type TagKind = 'status' | 'result' | 'sample_type' | 'stock' | 'priority' | 'gap' | 'contract_status' | 'order_status';

const STATUS: Record<string, Color> = {
  requested: 'gray',
  preparing: 'amber',
  // Derived, not a stored status (lifecycle sketch 2026-09-14): the AWB is on file but the courier
  // has not collected — shown in place of requested/preparing, see sampleStatusTag().
  awaiting_collection: 'indigo',
  dispatched: 'blue',
  delivered: 'teal',
  results_in: 'purple',
  cancelled: 'red',
};

const RESULT: Record<string, Color> = {
  approved: 'green',
  rejected: 'red',
  pending_feedback: 'amber',
};

const SAMPLE_TYPE: Record<string, Color> = {
  offer: 'blue',
  type: 'indigo',
  pss: 'teal',
  woc: 'orange',
  retention: 'gray',
  flavor_mapping: 'pink',
  marketing: 'purple',
  calibration: 'green',
  other: 'gray',
};

// Stock availability against the row's send quantity (migration 010).
const STOCK: Record<string, Color> = {
  low_stock: 'amber',
  out_of_stock: 'red',
};

// Urgency flag (migration 011, feedback #25 — Ivo). 'normal' is the default and renders no badge.
const PRIORITY: Record<string, Color> = {
  urgent: 'red',
  normal: 'gray',
};

// Data gaps the Quality desk has to close before a sample can ship (migration 016):
// today just the missing delivery address, flagged on the sample AND the client.
const GAP: Record<string, Color> = {
  address_needed: 'amber',
};
// Gap values read as a call to action, not an enum state, so they get a sentence-case
// label instead of StatusBadge's default lowercase humanization.
const GAP_LABELS: Record<string, string> = {
  address_needed: 'Address needed',
};

// Where a contract stands on its pre-shipment samples (migration 020). Everything but `open`,
// `shipped` and `cancelled` is derived from the containers' verdicts, so the colors run the same
// route as a sample's result: amber while it's owed, blue part-way, green approved, red rejected.
const CONTRACT_STATUS: Record<string, Color> = {
  open: 'gray',
  pss_pending: 'amber',
  pss_partial: 'blue',
  pss_approved: 'green',
  pss_replacement_rejected: 'red',
  shipped: 'teal',
  cancelled: 'gray',
};
// "PSS" is an initialism the desk says out loud — humanizing it to "pss partial" reads as a typo.
// The flag state is Harriet's own wording (2026-09-10): "PSS Replacement Rejected".
const CONTRACT_STATUS_LABELS: Record<string, string> = {
  pss_pending: 'PSS pending',
  pss_partial: 'PSS partial',
  pss_approved: 'PSS approved',
  pss_replacement_rejected: 'PSS replacement rejected',
};

// Where an order (consignment, round 10) stands, derived by the API from its members: the
// sample lifecycle colours, with the half-way state in amber like a pending result.
const ORDER_STATUS: Record<string, Color> = {
  requested: 'gray',
  partly_dispatched: 'amber',
  dispatched: 'blue',
  delivered: 'teal',
  closed: 'gray',
};
const ORDER_STATUS_LABELS: Record<string, string> = {
  partly_dispatched: 'Partly dispatched',
};

const MAPS: Record<TagKind, Record<string, Color>> = {
  status: STATUS,
  result: RESULT,
  sample_type: SAMPLE_TYPE,
  stock: STOCK,
  priority: PRIORITY,
  gap: GAP,
  contract_status: CONTRACT_STATUS,
  order_status: ORDER_STATUS,
};

export function tagColor(kind: TagKind, value: string): string {
  return PALETTE[MAPS[kind][value] ?? 'gray'];
}

/** Display text for a tag value: the humanized snake_case (`results_in` → "results in")
 * everywhere except the gap and contract kinds, whose labels are hand-written. */
export function tagLabel(kind: TagKind, value: string): string {
  if (kind === 'gap' && GAP_LABELS[value]) return GAP_LABELS[value];
  if (kind === 'contract_status' && CONTRACT_STATUS_LABELS[value]) return CONTRACT_STATUS_LABELS[value];
  if (kind === 'order_status' && ORDER_STATUS_LABELS[value]) return ORDER_STATUS_LABELS[value];
  return value.replace(/_/g, ' ');
}

/** 'out_of_stock' at zero grams, 'low_stock' when the lab holds less than the row
 * needs to send, null when untracked or sufficient (no badge). Values double as
 * StatusBadge labels ("low stock" / "out of stock"). */
/** The status pill's value for a sample row: 'awaiting_collection' when the API says the AWB is on
 * file but the parcel has not left (status still requested/preparing), otherwise the stored status.
 * The drawer's Status select keeps showing the stored value — this only changes what is displayed. */
export function sampleStatusTag(row: { status?: unknown; awaiting_collection?: unknown }): string | null {
  if (row.awaiting_collection === true) return 'awaiting_collection';
  return typeof row.status === 'string' && row.status ? row.status : null;
}

export function stockTag(stock: unknown, qty: unknown): 'low_stock' | 'out_of_stock' | null {
  if (typeof stock !== 'number') return null;
  if (stock <= 0) return 'out_of_stock';
  if (typeof qty === 'number' && stock < qty) return 'low_stock';
  return null;
}
