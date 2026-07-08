import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { ChartShell } from './ChartShell';
import { ChartTooltip } from './ChartTooltip';
import { PRIMARY_HEX, chartChrome, humanize, useIsDark } from './colors';
import { isAllZero, recordToBuckets, sortByValueDesc } from './utils';

/** Couriers are an open-ended, non-semantic set (carrier names) — no tags.ts
 * precedent and no meaningful "identity" beyond the bar's own axis label, so per
 * the dataviz skill this stays one hue (the app's `--primary` accent) rather than
 * a categorical ramp: coloring each bar differently would just re-encode what the
 * bar's length already shows. */
export function CourierBarChart({
  data,
  loading,
  motionDelayMs,
}: {
  data?: Record<string, number>;
  loading?: boolean;
  motionDelayMs?: number;
}) {
  const isDark = useIsDark();
  const chrome = chartChrome(isDark);
  const buckets = sortByValueDesc(recordToBuckets(data));
  const rows = buckets.map((b) => ({ ...b, label: humanize(b.key) }));

  return (
    <ChartShell
      title="Samples by courier"
      loading={loading}
      isEmpty={isAllZero(buckets)}
      emptyMessage="No dispatches yet"
      motionDelayMs={motionDelayMs}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 24 }}>
          <CartesianGrid stroke={chrome.grid} vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tick={{ fill: chrome.tick, fontSize: 10 }}
            axisLine={{ stroke: chrome.axis }}
            tickLine={false}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={40}
          />
          <YAxis allowDecimals={false} tick={{ fill: chrome.tick, fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
          <Tooltip cursor={{ fill: chrome.grid, opacity: 0.5 }} content={<ChartTooltip chrome={chrome} />} />
          <Bar dataKey="value" name="samples" fill={PRIMARY_HEX} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
