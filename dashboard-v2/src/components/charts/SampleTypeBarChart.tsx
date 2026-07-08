import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { ChartShell } from './ChartShell';
import { ChartTooltip } from './ChartTooltip';
import { SAMPLE_TYPE_ORDER, chartChrome, colorForSampleType, humanize, useIsDark } from './colors';
import { isAllZero, recordToBuckets } from './utils';

export function SampleTypeBarChart({
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
  const buckets = recordToBuckets(data, SAMPLE_TYPE_ORDER);
  const rows = buckets.map((b) => ({ ...b, label: humanize(b.key) }));

  return (
    <ChartShell
      title="Samples by type"
      loading={loading}
      isEmpty={isAllZero(buckets)}
      emptyMessage="No samples yet"
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
          <Bar dataKey="value" name="samples" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell key={row.key} fill={colorForSampleType(row.key)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
