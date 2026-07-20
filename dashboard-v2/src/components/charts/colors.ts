// Chart color system for the Dashboard (Phase 4).
//
// `src/lib/tags.ts` already assigns one fixed hue per status/result/sample_type
// value, shipped as Tailwind bg/text CLASS pairs for badges. Recharts marks need a
// raw fill hex, not a class, so this file re-derives a matching HEX ramp from the
// same Tailwind color families (the 500-weight step — the mid-saturation tone that
// reads as a solid fill on both a white and a near-black card surface) and keys it
// by the *same* value strings tags.ts uses, so a "results_in" bar here and a
// "results_in" badge in a table share one identity across the app.
//
// Validated with the dataviz skill's `validate_palette.js` against this app's own
// card surfaces (light #ffffff / dark #1b1e28 — the hex conversion of `--card` in
// `src/index.css`): contrast clears >=3:1 in both modes for every slot below. The
// CVD-separation and chroma-floor checks reproduce the *same* sub-floor collisions
// tags.ts's own header comment already documents for this hue set (a violet/blue
// deuteranopia collision; the intentionally low-chroma "gray" slot) — a structural
// property of reusing this exact badge palette, not something new introduced here.
// tags.ts's mitigation is "never carry identity by color alone, always render the
// label" — every chart below repeats that: category axes, legends, and tooltips
// always show the text label, never a bare color swatch.
//
// `by_tab` (specialty/bulk/forwarding) has no tags.ts precedent, so those 3 slots
// are a fresh assignment instead: the dataviz skill's reference categorical order
// (blue / aqua / yellow), independently validated per-mode — both light and dark
// come back ALL-PASS (incl. CVD) against this app's card surfaces.
//
// Single-series magnitude charts (volume over time, by-courier, by-country) use
// the app's own `--primary` accent (identical hex in light+dark per index.css)
// rather than a categorical ramp: per the dataviz skill, a lone measure across
// nominal categories should stay one hue — the axis label already carries
// identity, so coloring each bar differently would just re-encode what the bar's
// length already shows.

import { useEffect, useState } from 'react';

/** True when `<html class="dark">` is set (see `src/lib/theme.ts`). Charts render
 * to an SVG canvas rather than the DOM's CSS cascade, so they can't pick up
 * `hsl(var(--token))` the way the rest of the app does — this hook re-reads the
 * theme class via a MutationObserver so a chart re-colors the moment
 * `toggleTheme()` flips it, without needing a remount. */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains('dark'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

export type ChartChrome = {
  grid: string;
  axis: string;
  tick: string;
  tooltipBg: string;
  tooltipBorder: string;
  text: string;
};

// Hex conversions of this app's own `--border` / `--muted-foreground` / `--card` /
// `--foreground` tokens (src/index.css) — chart chrome stays a literal step behind
// the same hairline-border, muted-label language the rest of the UI uses.
const CHROME: Record<'light' | 'dark', ChartChrome> = {
  light: {
    grid: '#e5e7eb',
    axis: '#e5e7eb',
    tick: '#6b7280',
    tooltipBg: '#ffffff',
    tooltipBorder: '#e5e7eb',
    text: '#252a37',
  },
  dark: {
    grid: '#31363f',
    axis: '#31363f',
    tick: '#9096a2',
    tooltipBg: '#1b1e28',
    tooltipBorder: '#31363f',
    text: '#e2e4e9',
  },
};

export function chartChrome(isDark: boolean): ChartChrome {
  return isDark ? CHROME.dark : CHROME.light;
}

/** `--primary` (217 91% 50%) — identical value in light and dark per index.css. */
export const PRIMARY_HEX = '#0b64f4';

export const STATUS_ORDER = ['requested', 'preparing', 'dispatched', 'delivered', 'results_in', 'cancelled'] as const;
export const STATUS_COLORS: Record<string, string> = {
  requested: '#64748b', // slate — tags.ts "gray"
  preparing: '#f59e0b', // amber
  dispatched: '#3b82f6', // blue
  delivered: '#14b8a6', // teal
  results_in: '#8b5cf6', // violet
  cancelled: '#f43f5e', // rose
};

export const SAMPLE_TYPE_ORDER = [
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
export const SAMPLE_TYPE_COLORS: Record<string, string> = {
  offer: '#3b82f6', // blue
  type: '#6366f1', // indigo
  pss: '#14b8a6', // teal
  woc: '#f97316', // orange
  retention: '#64748b', // gray
  flavor_mapping: '#ec4899', // pink
  marketing: '#8b5cf6', // violet
  calibration: '#10b981', // green
  other: '#64748b', // gray
};

export const TAB_ORDER = ['specialty', 'bulk', 'forwarding'] as const;
// Display names for the tab keys — `bulk` is shown as "Commercial" (client-approved
// wording); the key itself stays `bulk` end-to-end (DB/API/routes).
export const TAB_LABEL: Record<string, string> = {
  specialty: 'Specialty',
  bulk: 'Commercial',
  forwarding: 'Forwarding',
};
const TAB_COLORS: Record<'light' | 'dark', Record<string, string>> = {
  light: { specialty: '#2a78d6', bulk: '#1baf7a', forwarding: '#eda100' },
  dark: { specialty: '#3987e5', bulk: '#199e70', forwarding: '#c98500' },
};

export function tabColorHex(isDark: boolean, key: string): string {
  const map = isDark ? TAB_COLORS.dark : TAB_COLORS.light;
  return map[key] ?? (isDark ? '#9096a2' : '#6b7280');
}

export function colorForStatus(value: string): string {
  return STATUS_COLORS[value] ?? '#64748b';
}

export function colorForSampleType(value: string): string {
  return SAMPLE_TYPE_COLORS[value] ?? '#64748b';
}

export function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}
