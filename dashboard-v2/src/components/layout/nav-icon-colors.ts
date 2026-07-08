// Per-nav-item icon tint for the Sidebar's "Workspace" section. Echoes the
// Twenty-style multi-color tag palette used for status/tag pills
// (`src/lib/tags.ts`) so the sidebar reads as part of the same color system,
// while staying independent of it (nav identity colors are permanent per
// item, not data-driven like a tag). Kept as its own tiny lookup — rather
// than inlining Tailwind classes at each `<Icon>` call site — so adding a
// nav item only means naming a color, not memorizing a class string.
export const NAV_ICON_COLORS = {
  slate: 'text-slate-500 dark:text-slate-400',
  violet: 'text-violet-500 dark:text-violet-400',
  amber: 'text-amber-500 dark:text-amber-400',
  blue: 'text-blue-500 dark:text-blue-400',
  teal: 'text-teal-500 dark:text-teal-400',
} as const;

export type NavIconColor = keyof typeof NAV_ICON_COLORS;
