# Sucafina Sample Desk — Design Language

A complete reference for replicating the look and feel of `dashboard-v2` in another
project. Everything here is lifted from the live code (`dashboard-v2/src`), so the
values are the real ones, not approximations. Copy the **Bootstrap** section at the
end to get a new app onto this system in ~5 minutes.

---

## 1. Philosophy

The UI is modelled on **Twenty CRM**'s low-chrome, data-dense aesthetic:

- **Neutral first.** Every gray is a *true* neutral (hue 0°, saturation 0%) — no blue
  tint. Surfaces are white/near-white; text is charcoal, never pure black.
- **One accent, used sparingly.** A single indigo-blue (`226° 70% 55%`) is reserved
  for the primary action, focus rings, the brand mark, table-row selection tint and
  links. Navigation active state, hover, tabs and chips use *gray* — never the accent.
- **Hairline borders, almost no shadow.** Structure comes from 1px `--border` lines
  and subtle surface steps (`bg-muted`), not from drop shadows. Only floating layers
  (dialogs, popovers, drawers) get a shadow.
- **Dense but legible.** Base type is 13px, controls are 32px tall, table rows are
  32px, page padding is 16px. Compact (28px) variants exist for toolbars.
- **Color carries meaning, never identity alone.** Status/tag colors always pair with
  a text label; charts always render labels/legends next to their swatches.
- **Quiet motion.** 150–180ms ease-out fades/slides, short staggers on mount, no
  bouncy springs.
- **Light only (for now).** A full dark token set exists and every component is
  dark-ready, but the toggle is disabled (client feedback #4) and `theme.ts` pins
  `light`.

---

## 2. Stack

| Concern | Choice |
|---|---|
| Framework | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS 3.4, `darkMode: 'class'`, `tailwindcss-animate` |
| Components | shadcn/ui (`new-york` style, CSS variables on) over Radix primitives |
| Icons | `@tabler/icons-react` (stroke icons, `size-4` default, `size-3.5` compact) |
| Font | Inter 400/500/600 via Google Fonts, `system-ui, sans-serif` fallback |
| Class merging | `clsx` + `tailwind-merge` via `cn()` (`src/lib/cn.ts`) |
| Variants | `class-variance-authority` |
| Motion | CSS keyframes + `tailwindcss-animate`; `framer-motion` only for drawer/banner content |
| Charts | Recharts with app chrome colors injected |
| Tables | TanStack Table + TanStack Virtual |
| Command palette | `cmdk` inside a Radix Dialog |

`components.json`:

```json
{ "style": "new-york", "tailwind": { "baseColor": "slate", "cssVariables": true },
  "aliases": { "components": "@/components", "utils": "@/lib/cn" } }
```

---

## 3. Color tokens

All colors are HSL triplets in CSS variables, consumed through Tailwind as
`hsl(var(--token))`. **Neutrals have zero saturation.**

### 3.1 Light (default)

| Token | HSL | ≈ Hex | Role |
|---|---|---|---|
| `--background` | `0 0% 99%` | `#fcfcfc` | App canvas, sidebar, inputs, table header/pinned cells |
| `--foreground` | `0 0% 20%` | `#333333` | Primary text |
| `--card` | `0 0% 100%` | `#ffffff` | Cards, drawers, dialogs, tab-active pill |
| `--card-foreground` | `0 0% 20%` | `#333333` | |
| `--popover` | `0 0% 100%` | `#ffffff` | Popovers, selects, tooltips, filter panels |
| `--popover-foreground` | `0 0% 20%` | `#333333` | |
| `--primary` | `226 70% 55%` | `#3b63dc` | **The** accent (Radix indigo9-inspired) |
| `--primary-foreground` | `0 0% 100%` | `#ffffff` | |
| `--secondary` | `0 0% 95%` | `#f2f2f2` | Secondary buttons, timeline event chips |
| `--secondary-foreground` | `0 0% 20%` | | |
| `--muted` | `0 0% 96%` | `#f5f5f5` | Hover fills, active nav, tab-list track, skeletons, kbd |
| `--muted-foreground` | `0 0% 45%` | `#737373` | Secondary text, labels, icons, placeholders |
| `--accent` | `226 100% 97%` | `#f0f4ff` | Faint blue: selected row, active filter chip, highlight banner, menu-item focus |
| `--accent-foreground` | `226 70% 40%` | `#1f41ad` | Text on `--accent` |
| `--destructive` | `0 72% 51%` | `#dc2626`-ish | Delete/error |
| `--destructive-foreground` | `0 0% 100%` | | |
| `--border` | `0 0% 90%` | `#e5e5e5` | Hairline dividers, card borders, table lines |
| `--input` | `0 0% 87%` | `#dedede` | Input/select borders (one step darker than `--border`) |
| `--ring` | `226 70% 55%` | | Focus ring (= primary) |
| `--radius` | `0.5rem` | 8px | Card/panel radius (`rounded-lg`) |

### 3.2 Dark (`.dark` on `<html>`; currently disabled)

| Token | HSL |
|---|---|
| `--background` | `0 0% 9%` |
| `--foreground` | `0 0% 92%` |
| `--card` / `--popover` | `0 0% 12%` |
| `--primary` | `226 70% 63%` |
| `--secondary` | `0 0% 16%` |
| `--muted` | `0 0% 15%` |
| `--muted-foreground` | `0 0% 63%` |
| `--accent` | `226 35% 22%` |
| `--accent-foreground` | `226 85% 82%` |
| `--destructive` | `0 65% 55%` |
| `--border` / `--input` | `0 0% 27%` |
| `--ring` | `226 70% 63%` |

### 3.3 Where the accent may appear

| ✅ Allowed | ❌ Not allowed |
|---|---|
| `Button variant="default"` (primary CTA) | Sidebar active item (uses `bg-muted`) |
| Focus rings | Hover states (use `bg-muted` / `bg-accent`) |
| Brand mark square | Card borders / headers |
| Table row selected (`data-[state=selected]:bg-accent`) | KPI numbers (use `text-foreground`) |
| Active filter chip (`bg-accent text-accent-foreground`) | Section titles |
| Active top-level segmented tab (SampleTabs) | Tooltips |
| Row-flash deep-link pulse | |
| Links (`text-primary hover:underline`) | |
| Timeline dot, owner avatar (`bg-primary/15 text-primary`) | |
| Single-series charts (bar/area fill) | |

### 3.4 Semantic tag palette (badges)

Ten Tailwind families, each as a soft-100 background with 700 text (dark: 500/20%
bg, 300 text). Defined in `src/lib/tags.ts`. All pairs clear WCAG 4.5:1.

| Slot | Classes (light) |
|---|---|
| gray | `bg-slate-100 text-slate-700` |
| blue | `bg-blue-100 text-blue-700` |
| green | `bg-emerald-100 text-emerald-700` |
| amber | `bg-amber-100 text-amber-700` |
| red | `bg-rose-100 text-rose-700` |
| purple | `bg-violet-100 text-violet-700` |
| teal | `bg-teal-100 text-teal-700` |
| pink | `bg-pink-100 text-pink-700` |
| orange | `bg-orange-100 text-orange-700` |
| indigo | `bg-indigo-100 text-indigo-700` |

Dark variant per slot: `dark:bg-{family}-500/20 dark:text-{family}-300`.

Domain assignments (keep these stable across surfaces — a value always has the
same hue whether it's a badge, a chart bar or a legend):

- **status**: requested→gray, preparing→amber, dispatched→blue, delivered→teal, results_in→purple, cancelled→red
- **result**: approved→green, rejected→red, pending_feedback→amber
- **sample_type**: offer→blue, type→indigo, pss→teal, woc→orange, retention→gray, flavor_mapping→pink, marketing→purple, calibration→green, other→gray
- **stock**: low_stock→amber, out_of_stock→red
- **priority**: urgent→red, normal→gray (normal renders no badge)

### 3.5 Nav / section identity tints

Icon-only tints at the 500 weight (400 in dark). Permanent per nav item, not
data-driven. `src/components/layout/nav-icon-colors.ts`:

`slate` Dashboard · `violet` Sample Management · `teal` Clients · `amber` Consignments ·
`rose` Chaser · `indigo` Chat Agent. (Also `blue` available.)

Chaser buckets reuse the same idea: rose = overdue, amber = no delivery confirmation,
blue = awaiting results; `text-emerald-500` check icon for "all clear".

### 3.6 Chart colors (`src/components/charts/colors.ts`)

Hex versions of the same families at 500 weight:

```
status:  requested #64748b · preparing #f59e0b · dispatched #3b82f6
         delivered #14b8a6 · results_in #8b5cf6 · cancelled #f43f5e
type:    offer #3b82f6 · type #6366f1 · pss #14b8a6 · woc #f97316 · retention #64748b
         flavor_mapping #ec4899 · marketing #8b5cf6 · calibration #10b981 · other #64748b
tabs:    light  specialty #2a78d6 · bulk #1baf7a · forwarding #eda100
         dark   specialty #3987e5 · bulk #199e70 · forwarding #c98500
```

Chart chrome (grid/axis/tick/tooltip) light: grid & axis `#e5e7eb`, tick `#6b7280`,
tooltip bg `#ffffff`, text `#252a37`. Dark: grid `#31363f`, tick `#9096a2`,
tooltip bg `#1b1e28`, text `#e2e4e9`.

> ⚠️ Known drift: `PRIMARY_HEX = '#0b64f4'` and the CHROME hexes in `colors.ts`
> were derived from an earlier blue-tinted palette (`217 91% 50%`). The CSS tokens
> have since moved to true neutrals + `226 70% 55%` (≈`#3b63dc`). When replicating,
> regenerate these hexes from the current tokens.

---

## 4. Typography

Font: **Inter** (400 regular, 500 medium, 600 semibold). No 700 anywhere.
`-webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility`.

Custom Tailwind size scale (overrides defaults — note `text-base` = `text-sm`):

| Class | Size / line-height | Use |
|---|---|---|
| `text-2xs` | 10px / 14px | `<kbd>` hints, pill timestamps |
| `text-xs` | 11px / 16px | Column headers, labels, hints, captions, badges, chips, sidebar section labels |
| `text-sm` | 13px / 18px | **Body default**, inputs, buttons, nav items, table cells, dialog titles |
| `text-base` | 13px / 18px | Drawer title (same as sm — intentionally flat) |
| `text-lg` | 18px (Tailwind default) | Show-page `<h1>`, chaser summary numbers |
| `text-2xl` | 24px (Tailwind default) | KPI tile value |

Body: `font-size: 13px; line-height: 1.4`.

Recurring type roles:

```
Page/section h1 (header bar)   text-sm font-semibold
Show-page h1                    text-lg font-semibold text-foreground
Card title                      text-sm font-medium text-foreground
Card subtitle / helper          mt-0.5 text-xs text-muted-foreground
Page intro line                 text-xs text-muted-foreground
Field label / column header     text-xs font-medium uppercase tracking-wide text-muted-foreground
Sidebar section label           text-xs font-medium uppercase tracking-wide text-muted-foreground/70
KPI label                       text-xs font-medium uppercase tracking-wide text-muted-foreground
KPI value                       mt-2 text-2xl font-semibold text-foreground
Dialog title                    text-sm font-semibold leading-none tracking-tight
Dialog description              text-sm text-muted-foreground
Empty state                     py-6 text-center text-sm text-muted-foreground
Error inline                    text-xs|sm text-destructive
Numbers in tables/legends       tabular-nums
Keyboard hint                   font-mono text-2xs
```

Uppercase labels always get `tracking-wide`. Never uppercase body text.

---

## 5. Spacing, sizing, radius

### 5.1 Control heights

| Height | Class | Used for |
|---|---|---|
| 36px | `h-9` | `Button size="lg"`, sidebar collapse footer |
| 32px | `h-8` | **Default**: buttons, inputs, selects, tabs list, table rows, nav row, workspace switcher |
| 28px | `h-7` | Compact: `Button size="sm"`, filter chips, header search trigger, icon buttons in drawer header, toolbar inputs |
| 48px | `h-12` | Header bar, sidebar brand row |

### 5.2 Radius

| Value | Class | Applies to |
|---|---|---|
| 4px | `rounded-[4px]` | **All controls**: buttons, inputs, selects, badges, tabs, nav items, kbd, tooltips, select/dropdown menus, skeletons, table scroll container, contact cards, inline highlight banner |
| 6px | `rounded-md` | Chart tooltip, empty-plot placeholder |
| 8px | `rounded-lg` / `rounded-[8px]` | Cards, KPI tiles, chart shells, dialogs, popovers, filter panels, segmented top tabs |
| full | `rounded-full` | Status badges, filter chips, avatars, dots, scrollbar thumb |

Rule of thumb: *small things are 4px, containers are 8px, pills are full.*

### 5.3 Padding / gaps

```
Page container           flex flex-col gap-4 p-4        (gap-3 on sample list pages)
Card                     p-4
Card header → body       mt-3
Card inner grid          gap-3 (sm:grid-cols-2) / gap-4 (lg:grid-cols-3)
KPI grid                 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3
Chart grid               grid-cols-1 lg:grid-cols-2 gap-3
Drawer                   header px-5 py-4 · body px-5 pb-5 · tabs list mx-5 mt-3
Dialog                   p-6 gap-4 · max-w-sm/md/lg/[440px]
Form                     flex flex-col gap-4; field = flex flex-col gap-1.5
Detail dl                flex flex-col gap-4; field = flex flex-col gap-1
Table cell               px-3 py-1.5 · header h-8 px-3
Button                   px-3 (default) · px-2.5 (sm) · px-4 (lg) · gap-1.5 icon→label
Input/select             px-2.5 py-1
Badge                    px-1.5 py-0.5
Status pill              px-2 py-0.5 gap-1
Chip                     h-7, inner button px-3
Sidebar                  nav p-2 · item px-2.5 py-1.5 gap-2.5 · items gap-0.5 · groups gap-4
Header                   px-4 gap-4
Popover                  p-4 (w-72) · compact p-1.5 / p-2
Menu item                px-2 py-1.5 (pl-8 when indicator)
Tooltip                  px-2 py-1
```

Custom spacing: `4.5` = 18px.

### 5.4 Widths

Sidebar expanded `w-60` (240px), collapsed `w-14` (56px). Drawer `sm:max-w-[480px]`.
Header search trigger `w-56`. Workspace popover `w-56`. Filter panel `w-64`.
Select in card `w-64`. Table default column `150px`; table scroll area `max-h-[70vh]`.

---

## 6. Borders, elevation, surfaces

- Global: `* { @apply border-border }` — every `border` utility is a hairline neutral.
- Inputs use `border-input` (slightly darker than `border-border`).
- Shadows: `shadow-sm` on primary/destructive buttons, active tab pill, popovers,
  tooltips, select menus, segmented active tab. `shadow-md` on filter panels.
  `shadow-lg` on dialogs and drawers. Nothing else casts shadow.
- Overlay: `bg-foreground/20 backdrop-blur-[1px]`.
- Surface steps: canvas `--background` (99%) → card `--card` (100%) → hover
  `--muted` (96%). The card is *lighter* than the canvas; hover is darker.
- Pinned table column seam: `shadow-[inset_1px_0_0_hsl(var(--border))]` (not a
  border — border-collapse drops borders on sticky cells).
- Accent-edge card: `border-l-2 border-l-rose-400/70` (Chaser summary) — the only
  colored border in the system.
- Dashed borders for "nothing here yet" containers and unassigned avatars:
  `border-dashed border-border`.
- Scrollbars: 10px, transparent track, thumb `hsl(var(--border))`, `rounded-full`,
  2px `background`-colored inset border.

---

## 7. Layout shell

```
┌─ aside (w-60 | w-14, border-r, bg-background) ─┬─ column ──────────────────────────┐
│ h-12  [S] Sucafina ▾        (workspace popover) │ header h-12 border-b px-4         │
│ p-2   WORKSPACE (section label)                 │  [icon-tile] Section title  …  [Search… ⌘K] │
│       ● Dashboard                               ├───────────────────────────────────┤
│       ● Sample Management   (active: bg-muted)  │ main  min-h-0 flex-1 overflow-auto │
│       ● Clients                                 │   page content p-4 gap-4           │
│       …                                         │                                   │
│ h-9   ‹ Collapse  (border-t)                    │                                   │
└─────────────────────────────────────────────────┴───────────────────────────────────┘
```

- Root: `flex h-screen overflow-hidden bg-background text-foreground`.
- **Sidebar** `flex h-full shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200 ease-out`.
  - Brand mark: `size-5 rounded-[4px] bg-primary text-primary-foreground text-xs font-semibold` with a single letter.
  - Workspace button: `h-8 rounded-[4px] px-1.5 gap-2 hover:bg-muted`, name `text-sm font-semibold tracking-tight`, chevron `size-3.5 text-muted-foreground`.
  - Nav item: `flex items-center gap-2.5 rounded-[4px] px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground`; active adds `bg-muted text-foreground`. Icon `size-4` with its identity tint.
  - Collapsed: `justify-center px-0`, `title` attribute for tooltip.
  - Collapse footer: `h-9 border-t px-2.5 text-muted-foreground hover:bg-muted`, chevron rotates 180° (`transition-transform duration-200`).
- **Header** `flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-4`.
  - Left: icon tile `size-5 rounded-[4px] bg-muted` + tinted `size-3.5` icon, then `h1 text-sm font-semibold truncate`.
  - Right: search trigger `h-7 w-56 rounded-[4px] border bg-background px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground` with `IconSearch size-3.5`, "Search…", and `<kbd class="rounded-[4px] border bg-muted px-1 py-0.5 font-mono text-2xs leading-none">⌘K</kbd>`.
- Pages never repeat the section title (the header owns the h1); they open with a
  `text-xs text-muted-foreground` one-line intro.
- Show pages (client/consignment detail) start with a back link:
  `inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground` + `IconArrowLeft size-3.5`.

---

## 8. Component catalogue

All class strings below are the actual implementation. `cn()` merges overrides.

### 8.1 Button (`ui/button.tsx`)

Base: `inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[4px] text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0`

| Variant | Classes |
|---|---|
| default | `bg-primary text-primary-foreground shadow-sm hover:bg-primary/90` |
| destructive | `bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90` |
| outline | `border border-border bg-background hover:bg-accent hover:text-accent-foreground` |
| secondary | `bg-secondary text-secondary-foreground hover:bg-secondary/80` |
| ghost | `hover:bg-accent hover:text-accent-foreground` |
| link | `text-primary underline-offset-4 hover:underline` |

| Size | Classes |
|---|---|
| default | `h-8 px-3` |
| sm | `h-7 px-2.5 text-xs` |
| lg | `h-9 px-4` |
| icon | `h-8 w-8` (drawer header uses `h-7 w-7`) |

Conventions: primary CTA is `size="sm"` with a `size-3.5` icon (`<IconPlus/> New`).
Destructive icon button: `ghost` + `text-muted-foreground hover:bg-destructive/10 hover:text-destructive`.
"Clear all" is `ghost sm h-7 gap-1 text-xs text-muted-foreground`.

### 8.2 Input / Select trigger

`flex h-8 w-full rounded-[4px] border border-input bg-background px-2.5 py-1 text-sm text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50`

- Note the **1px** focus ring on inputs vs 2px on buttons.
- Compact toolbar input: `h-7 w-48 pl-7 text-xs` with an absolutely-positioned `IconSearch size-3.5 left-2 text-muted-foreground`.
- Select chevron: `IconChevronDown size-4 text-muted-foreground`.

### 8.3 Select / Dropdown / Popover content

- Select & dropdown menu content: `z-50 min-w-32 overflow-hidden rounded-[4px] border border-border bg-popover text-popover-foreground shadow-sm` + animate-in/out fade+zoom-95, viewport `p-1`.
- Item: `relative flex w-full cursor-default select-none items-center rounded-[4px] py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:opacity-50`; check indicator `size-4` at `left-2`.
- Label: `px-2 py-1.5 text-xs font-medium text-muted-foreground`. Separator `-mx-1 my-1 h-px bg-border`. Shortcut `ml-auto text-xs tracking-widest text-muted-foreground`.
- Popover: `z-50 w-72 rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-sm outline-none` + fade/zoom. (8px radius — a panel, not a menu.)

### 8.4 Tabs (inside drawers/cards)

- List: `inline-flex h-8 items-center justify-center gap-1 rounded-[4px] bg-muted p-0.5 text-muted-foreground` (use `w-fit`).
- Trigger: `inline-flex items-center justify-center whitespace-nowrap rounded-[4px] px-2.5 py-1 text-sm font-medium transition-colors duration-150 … data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm`.
- Content: `mt-2`.

### 8.5 Segmented top-level tabs (`SampleTabs`)

Route-level tab strip; the *only* place tabs use the accent:
`grid grid-cols-3 gap-3` → each `flex items-center justify-center rounded-[8px] border px-4 py-2 text-sm font-medium transition-colors duration-150`;
active `border-primary bg-primary text-primary-foreground shadow-sm`;
inactive `border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground`.

### 8.6 Badge (`ui/badge.tsx`) — generic chip

`inline-flex items-center rounded-[4px] border px-1.5 py-0.5 text-xs font-medium`
— default `bg-primary text-primary-foreground`, secondary `bg-secondary`, destructive, outline `border-border`.
Used for "✨ Just created" in the highlight banner.

### 8.7 StatusBadge — semantic pill

```
<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none {tagColor}">
  <span class="size-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden />
  {value with _ → space}
</span>
```
Null value → `<span class="inline-flex items-center text-xs text-muted-foreground">—</span>`.

### 8.8 Filter chips + popover (`FilterBar`)

- Toolbar: `flex flex-wrap items-center gap-1.5`.
- Chip: `inline-flex h-7 items-center rounded-full border border-border bg-background text-xs text-foreground/80 transition-colors duration-150 hover:border-foreground/20`; active → `border-transparent bg-accent text-accent-foreground`.
- Trigger inside chip: `flex h-full items-center gap-1 px-3` with label (`max-w-[12rem] truncate`) and `IconChevronDown size-3.5 opacity-60`. Active chips show the value: `Label: value`.
- Clear button: `flex h-full items-center rounded-r-full pl-1 pr-2.5 hover:bg-accent-foreground/10` + `IconX size-3.5`.
- Panel (hand-rolled, fixed-position, **not** Radix — see code comment on the freeze bug): `z-50 rounded-lg border border-border bg-popover text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95`, `w-64 p-2`, `max-height: min(20rem, viewport)`.
- Option row: `flex min-w-0 cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground` with native checkbox `size-3.5 accent-primary`.
- Sticky search inside long lists: `sticky top-0 z-10 bg-popover pb-1` + `Input h-7 text-xs`.
- Labelled inputs in panel: `<label class="flex flex-col gap-1 text-xs text-muted-foreground">`.

### 8.9 Table (`ui/table.tsx` + `RecordTable`)

- Scroll container: `max-h-[70vh] overflow-auto rounded-[4px] border border-border`; dims to `opacity-60` while refetching (`transition-opacity duration-150`).
- `<table class="min-w-full table-fixed caption-bottom text-sm">` with explicit px widths per column (default 150).
- Header: `sticky top-0 z-10 bg-background`; `th` = `h-8 whitespace-nowrap px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground`; sortable adds `cursor-pointer select-none hover:text-foreground`.
- Sort indicator: inactive `IconSelector size-3.5 opacity-40`; active `IconChevronUp/Down size-3.5 text-foreground`. Three-state cycle asc → desc → off.
- Row: `h-8 border-b border-border transition-colors duration-150 hover:bg-muted/50 data-[state=selected]:bg-accent cursor-pointer`; last row `border-0`.
- Cell: `whitespace-nowrap px-3 py-1.5 align-middle text-sm truncate`; empty → `<span class="text-muted-foreground">—</span>`; numbers/dates `tabular-nums`; key ref column `font-medium`.
- Pinned right column: `sticky right-0 bg-background shadow-[inset_1px_0_0_hsl(var(--border))]`, body `z-[1] [tr:hover>&]:bg-muted`, header `z-20`.
- Loading: 8 skeleton rows (`Skeleton h-4 w-full` per cell). Error/empty: single cell `h-24 text-center text-muted-foreground`.
- Footer: `flex items-center justify-between text-xs text-muted-foreground` — "N records" left, `outline sm` Previous / "Page x of y" / Next right.
- Deep-link flash: row gets `animate-row-flash` (2.2s primary-tinted pulse).

### 8.10 Cards

Base card: `rounded-lg border border-border bg-card p-4`.

- **Section card** (show pages): `<section>` card with `h2 text-sm font-medium text-foreground`, optional `p mt-0.5 text-xs text-muted-foreground`, body `mt-3`.
- **Hero card** (show page header): `flex flex-col gap-4 … sm:flex-row sm:items-start sm:justify-between`; left `h1 text-lg font-semibold` + `text-sm text-muted-foreground` subline; right `flex shrink-0 gap-2` of `outline sm` buttons with `size-3.5` icons (Edit / Merge into… / Delete).
- **Header-bar card** (Chaser buckets): `rounded-lg border bg-card` with `flex items-center gap-2 border-b border-border px-4 py-3` header (`tinted icon size-4` + `h3 flex-1 text-sm font-semibold`) and table body.
- **Link card** (Chaser summary): `group flex items-center gap-4 rounded-lg border border-border border-l-2 border-l-rose-400/70 bg-card p-4 transition-colors hover:bg-muted/40`; counts `text-lg font-semibold tabular-nums` + `text-xs text-muted-foreground` labels; trailing `IconChevronRight size-4 transition-transform group-hover:translate-x-0.5`.
- **Nested item card** (contact): `rounded-[4px] border border-border p-3` (4px — it's a list item, not a panel).
- **Dashed empty card**: `rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground`.
- **Embed card** (chat iframe): `min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card`.

### 8.11 KPI tile

```
<div class="animate-fade-in rounded-lg border border-border bg-card p-4" style="animation-delay:{i*40}ms; animation-fill-mode:backwards">
  <div class="text-xs font-medium uppercase text-muted-foreground tracking-wide">Label</div>
  <div class="mt-2 text-2xl font-semibold text-foreground">1,234</div>     ← or <Skeleton class="mt-2 h-7 w-16"/>
  <div class="mt-1 text-xs text-muted-foreground">hint</div>
</div>
```

### 8.12 ChartShell

Same card as KPI; header `mb-3 flex items-start justify-between gap-3` with `h3 text-sm font-medium` + `p mt-0.5 text-xs text-muted-foreground` subtitle and optional `corner` slot; plot area fixed `height` (260px default). Loading → full-size Skeleton; empty → `flex h-full items-center justify-center rounded-md bg-secondary/20` + `text-sm text-muted-foreground` message. Stagger: charts start after KPIs (`7*40ms`), then `+60ms` each.

Recharts conventions: `CartesianGrid vertical={false} strokeDasharray="3 3"`; X tick `fontSize 11` fill chrome.tick, `tickLine={false}`; Y `axisLine={false} tickLine={false} width={36}`; bars `radius=[4,4,0,0] maxBarSize=44`; `isAnimationActive={false}`; tooltip cursor `{fill: chrome.grid, opacity: .5}`; donut `innerRadius 58% outerRadius 88% paddingAngle 2 stroke transparent` with a side legend (`h-2.5 w-2.5 rounded-full` swatch, label, `tabular-nums text-muted-foreground` count).

ChartTooltip: `rounded-md border px-2.5 py-1.5 text-xs shadow-sm`, label `mb-1 font-medium capitalize`, rows `h-2 w-2 rounded-full` swatch + `capitalize text-muted-foreground` name + `font-medium tabular-nums` value.

### 8.13 Dialog

Overlay `fixed inset-0 z-50 bg-foreground/20 backdrop-blur-[1px]` fade. Content `fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg duration-150` + fade/zoom-95. Close `absolute right-4 top-4 rounded-[4px] text-muted-foreground opacity-70 hover:opacity-100` `IconX size-4`.
Header `flex flex-col space-y-1.5 text-left`; title `text-sm font-semibold leading-none tracking-tight`; description `text-sm text-muted-foreground`; footer `flex flex-col-reverse gap-2 sm:flex-row sm:justify-end` → `outline` Cancel + `default`/`destructive` confirm. Pending label "Deleting…" / "Saving…". Sizes used: `sm:max-w-sm` (confirm), `sm:max-w-md`, `sm:max-w-[440px]`, `max-w-xl` (command).

Forms in dialogs: `form flex flex-col gap-4`; field `flex flex-col gap-1.5` → `label text-xs font-medium uppercase tracking-wide text-muted-foreground` (required `<span class="text-destructive"> *</span>`) + `h-8 text-sm` Input/Select. Inline "+ add" affordance: `self-start text-xs font-medium text-primary hover:underline`. Error: `text-xs|sm text-destructive`.

### 8.14 Sheet / Detail drawer

Sheet content: `fixed z-50 gap-4 border-border bg-card p-6 text-card-foreground shadow-lg transition ease-in-out duration-150` + slide from side; right = `inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-md`.
DetailDrawer overrides to `flex w-full flex-col gap-0 p-0 sm:max-w-[480px]` and wraps content in `motion.div initial={{opacity:0,x:16}} animate={{opacity:1,x:0}} transition={{duration:.18,ease:'easeOut'}}`.

- Header: `shrink-0 border-b border-border px-5 py-4`, title `text-base` (13px) semibold, actions `h-7 w-7` ghost icons (print, delete) left of the Radix close X.
- Optional HighlightBanner `px-5 pt-3`: `flex items-center gap-2 rounded-[4px] bg-accent px-3 py-2 text-sm text-accent-foreground` → `<Badge>✨ Just created</Badge>` + `opacity-70` explanation.
- Tabs list `mx-5 mt-3 w-fit` (Details / Timeline / Related); content `min-h-0 flex-1 overflow-auto px-5 pb-5`.
- Details `dl flex flex-col gap-4 pt-2`; `dt` = uppercase label style; `dd text-sm text-foreground` holding either text, an `h-8 text-sm` Input/Select (commit on blur/Enter/select), or a renderer (badge).
- Loading: 5× (`Skeleton h-3 w-16` + `Skeleton h-8 w-full`) in `gap-4`.

### 8.15 Timeline

`ol flex flex-col gap-4`; item `relative flex gap-3`; rail column `w-3` with dot `mt-1 size-[7px] rounded-full bg-primary` and connector `mt-1 w-px flex-1 bg-border`; content: event type chip `rounded-[4px] bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground` + `time text-xs text-muted-foreground` (relative < 7d, else `Mon D, YYYY`), note `mt-1 text-sm`, actor `mt-0.5 text-xs text-muted-foreground`. Empty: `py-6 text-center text-sm text-muted-foreground`.

### 8.16 Command menu (⌘K)

`DialogContent top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 [&>button]:hidden`; cmdk input row `flex items-center gap-2 border-b border-border px-3` with `IconSearch size-4 text-muted-foreground`; group headings `px-2 py-1.5 text-xs font-medium text-muted-foreground`; items show nav icon `size-4`; list `max-h-80`; loading row `IconLoader2 size-3.5 animate-spin`; empty `py-6 text-center text-sm text-muted-foreground`; record hits `flex-1 truncate` with secondary text `ml-1.5 text-muted-foreground`.

### 8.17 Tooltip

`z-50 rounded-[4px] border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm` + fade/zoom, `sideOffset 4`.

### 8.18 Skeleton

`animate-pulse rounded-[4px] bg-muted`. Sizes: text `h-3 w-16`/`h-4 w-24`, control `h-8 w-full`, KPI `h-7 w-16`, card `h-24..h-48 w-full rounded-lg`.

### 8.19 Owner chip / avatar

Assigned: `size-7 rounded-full bg-primary/15 text-xs font-semibold text-primary` initials + stacked `text-sm font-medium` name / `text-xs text-muted-foreground` role (`leading-tight`).
Unassigned: `size-7 rounded-full border border-dashed border-border text-muted-foreground` with `IconUserOff size-3.5` + "Unassigned — no account owner".

### 8.20 Links

Inline record link: `font-medium text-primary hover:underline`. Quiet nav link: `text-muted-foreground hover:text-foreground`.

---

## 9. Motion

| Name | Definition | Used |
|---|---|---|
| `fade-in` | opacity 0→1, 150ms ease-out | KPI tiles, chart shells (staggered via `animation-delay`, `fill-mode: backwards`) |
| `slide-in-right` | translateX 100%→0, 180ms ease-out | (available) |
| `row-flash` | bg transparent → `primary/0.22` ↔ `accent` pulses, 2.2s ease-in-out | Deep-linked table row |
| Radix enter/exit | `animate-in fade-in-0 zoom-in-95` / `animate-out fade-out-0 zoom-out-95`, 150ms | Dialog, popover, select, tooltip, filter panel |
| Sheet | `slide-in-from-right` 150ms ease-in-out | Drawer |
| framer-motion | `{opacity:0, x:16|y:-4} → {1, 0}`, 0.18s easeOut | Drawer content, highlight banner |
| Transitions | `transition-colors duration-150` on every interactive element; `transition-[width] duration-200 ease-out` sidebar; `transition-transform duration-200` chevrons; `transition-opacity duration-150` refetch dimming (`opacity-60`) |

Stagger constants: KPI 40ms, charts 60ms, charts start at 7×40ms. Recharts animation is **off**.

---

## 10. Iconography

Tabler icons only. Sizes: `size-4` (16px) in buttons, nav, card headers; `size-3.5`
(14px) in compact buttons, chips, chevrons, header tile, sort hints; `size-2`–`2.5`
for swatch dots. Icons inherit `currentColor`; tinted only via the nav/bucket
palettes. Spinners: `IconLoader2`/`IconRefresh` + `animate-spin`. Common set:
Search, X, Plus, Pencil, Trash, Printer, ChevronDown/Up/Left/Right, Selector,
ArrowLeft, ArrowMerge, Check, CircleCheck, Alarm, TruckDelivery, ClipboardList,
BellRinging, LayoutDashboard, Flask2, Users, Packages, MessageChatbot, UserOff.

---

## 11. Data display conventions

- Missing value: em dash `—` in `text-muted-foreground`. Never "null"/"N/A".
- Enum values are stored snake_case and humanized for display (`_` → space), lowercase
  (`results in`, `pending feedback`); `capitalize` only in chart legends/tooltips.
- Dates: ISO `YYYY-MM-DD` in tables (`tabular-nums`); relative (`3h ago`, `2d ago`)
  inside the last week on timelines, then `Jul 23, 2026`.
- Quantities: grams below 1 kg (`300 g`), kilograms above (`1.5 kg`).
- Counts: `toLocaleString()`, `tabular-nums`.
- Pluralisation inline: `{n} record{n === 1 ? '' : 's'}`.
- Status is derived, never raw; "in transit" is labelled **"Dispatched / Delivery not confirmed"**.
- Never show a raw UUID as a title — fall back through ref → name → entity label.

---

## 12. Accessibility

- Focus: buttons/tabs `focus-visible:ring-2 ring-ring ring-offset-1`; inputs `ring-1`.
- All icon-only buttons carry `aria-label`; decorative icons `aria-hidden`.
- Sortable headers: `tabIndex=0`, Enter/Space, `aria-sort`.
- Filter triggers: `aria-haspopup="dialog" aria-expanded`.
- Tab strips: `role="tablist"` / `role="tab"`.
- Color never the only signal (labels on badges, legends on charts, dot + text on pills).
- Contrast: tag pairs ≥4.5:1; chart fills ≥3:1 on card surface.

---

## 13. Do / Don't

**Do**
- Reach for `text-muted-foreground` for anything secondary; `text-foreground` for values.
- Use `bg-muted` for hover/active on neutral chrome; `bg-accent` for *selection* and
  *active filters*.
- Keep every control at `h-8` unless it sits in a toolbar (`h-7`).
- Use `rounded-[4px]` on controls even when shadcn defaults say `rounded-md`.
- Put titles in the header bar, not the page body.
- Show skeletons in the exact shape of the content they replace.
- Stagger mount fades by 40–60ms.

**Don't**
- Don't use the accent for nav, hover, headings or borders.
- Don't use font-weight 700, italics, or letter-spacing except `tracking-wide` on
  uppercase micro-labels and `tracking-tight` on the brand/dialog title.
- Don't add box-shadows to cards, tables or inputs.
- Don't use tinted grays (`slate-*`, `zinc-*`) for chrome — only the neutral tokens.
  Tailwind color families are reserved for tags, nav tints and chart fills.
- Don't animate charts or use springs.
- Don't volunteer "prototype/simulated" copy anywhere in the UI.

---

## 14. Outliers (not part of the system)

- **Password gate page** (`dashboard-v2/middleware.ts`): a standalone branded login
  using system fonts, 18px/10px radii, a teal→green gradient bar and a radial mint
  background. It deliberately does *not* use the app tokens.
- **Print label** (`print-label.ts`): printer-oriented HTML, separate styling.

---

## 15. Bootstrap a new project

### `tailwind.config.ts`

```ts
import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
      },
      borderRadius: { lg: 'var(--radius)', md: '6px', sm: '4px' },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      fontSize: {
        '2xs': ['10px', '14px'],
        xs: ['11px', '16px'],
        sm: ['13px', '18px'],
        base: ['13px', '18px'],
      },
      spacing: { '4.5': '18px' },
      keyframes: {
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'row-flash': {
          '0%, 100%': { backgroundColor: 'transparent' },
          '10%, 40%, 70%': { backgroundColor: 'hsl(var(--primary) / 0.22)' },
          '25%, 55%, 85%': { backgroundColor: 'hsl(var(--accent))' },
        },
      },
      animation: {
        'slide-in-right': 'slide-in-right 180ms ease-out',
        'fade-in': 'fade-in 150ms ease-out',
        'row-flash': 'row-flash 2.2s ease-in-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
```

### `src/index.css`

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 99%;
    --foreground: 0 0% 20%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 20%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 20%;
    --primary: 226 70% 55%;
    --primary-foreground: 0 0% 100%;
    --secondary: 0 0% 95%;
    --secondary-foreground: 0 0% 20%;
    --muted: 0 0% 96%;
    --muted-foreground: 0 0% 45%;
    --accent: 226 100% 97%;
    --accent-foreground: 226 70% 40%;
    --destructive: 0 72% 51%;
    --destructive-foreground: 0 0% 100%;
    --border: 0 0% 90%;
    --input: 0 0% 87%;
    --ring: 226 70% 55%;
    --radius: 0.5rem;
  }
  .dark {
    --background: 0 0% 9%;
    --foreground: 0 0% 92%;
    --card: 0 0% 12%;
    --card-foreground: 0 0% 92%;
    --popover: 0 0% 12%;
    --popover-foreground: 0 0% 92%;
    --primary: 226 70% 63%;
    --primary-foreground: 0 0% 100%;
    --secondary: 0 0% 16%;
    --secondary-foreground: 0 0% 92%;
    --muted: 0 0% 15%;
    --muted-foreground: 0 0% 63%;
    --accent: 226 35% 22%;
    --accent-foreground: 226 85% 82%;
    --destructive: 0 65% 55%;
    --destructive-foreground: 0 0% 100%;
    --border: 0 0% 27%;
    --input: 0 0% 27%;
    --ring: 226 70% 63%;
  }
  * { @apply border-border; }
  body {
    @apply bg-background text-foreground;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background-color: hsl(var(--border));
    border-radius: 9999px;
    border: 2px solid hsl(var(--background));
  }
}
```

### Then

1. `npx shadcn@latest init` with `new-york`, CSS variables, alias `@/lib/cn`.
2. Add primitives (button, input, select, dialog, sheet, tabs, tooltip, popover,
   dropdown-menu, command, table, badge, skeleton) and apply the overrides in §8:
   `rounded-[4px]` on controls, `h-8`/`h-7` heights, `duration-150`, `ring-1` on
   inputs, `text-xs` labels, `shadow-sm` only on floating layers.
3. Swap lucide for `@tabler/icons-react`.
4. Copy `src/lib/tags.ts`, `src/components/StatusBadge.tsx`, `KpiTile.tsx`,
   `charts/ChartShell.tsx`, `charts/ChartTooltip.tsx`, `charts/colors.ts`
   (regenerate the hex chrome from the current tokens), `Timeline.tsx`,
   `layout/Sidebar.tsx`, `layout/Header.tsx`, `layout/nav-icon-colors.ts`.
5. Keep the shell: `flex h-screen overflow-hidden` → sidebar `w-60` + column with
   `h-12` header and `p-4 gap-4` pages.
