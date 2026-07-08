import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { ChartShell } from './ChartShell';
import { ChartTooltip } from './ChartTooltip';
import { PRIMARY_HEX, chartChrome, useIsDark } from './colors';
import { isAllZero, normalizeCountryCounts, topN } from './utils';

const TOP_N = 15;
const ROW_HEIGHT = 24;
const CHROME_HEIGHT = 40; // x-axis + margins

/** Horizontal bar, single hue, sorted descending — see CourierBarChart's note on
 * why an open-ended nominal group stays one hue instead of a categorical ramp.
 *
 * The live `/stats.by_country` payload carries un-normalized case duplicates from
 * the source data ("Kenya" / "KENYA" / "kenya" as separate keys) — rendering raw
 * keys would produce triplicate bars for the same country. `normalizeCountryCounts`
 * (utils.ts) Title-Cases each key and sums counts that collapse to the same label
 * before ranking; this is a presentation-only merge, the API response is untouched. */
export function CountryBarChart({
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
  const buckets = normalizeCountryCounts(data);
  const rows = topN(buckets, TOP_N);
  const height = Math.max(rows.length, 1) * ROW_HEIGHT + CHROME_HEIGHT;

  return (
    <ChartShell
      title="Samples by country"
      subtitle={buckets.length > TOP_N ? `Top ${TOP_N} of ${buckets.length}` : undefined}
      loading={loading}
      isEmpty={isAllZero(buckets)}
      emptyMessage="No country data yet"
      height={Math.max(height, 220)}
      className="lg:col-span-2"
      motionDelayMs={motionDelayMs}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 4 }}>
          <CartesianGrid stroke={chrome.grid} horizontal={false} strokeDasharray="3 3" />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fill: chrome.tick, fontSize: 11 }}
            axisLine={{ stroke: chrome.axis }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fill: chrome.tick, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={110}
          />
          <Tooltip cursor={{ fill: chrome.grid, opacity: 0.5 }} content={<ChartTooltip chrome={chrome} />} />
          <Bar dataKey="value" name="samples" fill={PRIMARY_HEX} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
