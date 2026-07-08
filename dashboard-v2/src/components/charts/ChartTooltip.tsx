import type { ChartChrome } from './colors';

type TooltipEntry = { value?: number | string | Array<number | string>; name?: string | number; color?: string };

/** One tooltip look shared by every chart — card surface, hairline border, theme
 * chrome text — so hovering any of the 6 charts feels like the same system rather
 * than 6 one-off styles. Never a color swatch alone: the series label always
 * renders next to the swatch.
 *
 * Typed as a small self-contained shape (not recharts' own `TooltipProps<V, N>`)
 * because recharts only exports the `ValueType`/`NameType` generics it needs from
 * an internal submodule, not its public root — passed as `content={<ChartTooltip
 * .../>}` (a bare element), recharts clones it and injects `active`/`payload`/
 * `label` at runtime regardless of the declared prop type. */
export function ChartTooltip({
  active,
  payload,
  label,
  chrome,
  formatter,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  chrome: ChartChrome;
  formatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div
      className="rounded-md border px-2.5 py-1.5 text-xs shadow-sm"
      style={{ backgroundColor: chrome.tooltipBg, borderColor: chrome.tooltipBorder, color: chrome.text }}
    >
      {label != null && label !== '' && <div className="mb-1 font-medium capitalize">{label}</div>}
      <div className="flex flex-col gap-0.5">
        {payload.map((entry, i) => {
          const raw = typeof entry.value === 'number' ? entry.value : Number(entry.value ?? 0);
          return (
            <div key={i} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color ?? chrome.text }}
              />
              <span className="capitalize text-muted-foreground">{entry.name ?? 'value'}</span>
              <span className="font-medium tabular-nums">{formatter ? formatter(raw) : raw.toLocaleString()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
