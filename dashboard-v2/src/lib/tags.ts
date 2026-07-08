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

export type TagKind = 'status' | 'result' | 'sample_type';

const STATUS: Record<string, Color> = {
  requested: 'gray',
  preparing: 'amber',
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

export function tagColor(kind: TagKind, value: string): string {
  const map = kind === 'status' ? STATUS : kind === 'result' ? RESULT : SAMPLE_TYPE;
  return PALETTE[map[value] ?? 'gray'];
}
