import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { ChartShell } from './ChartShell';
import { ChartTooltip } from './ChartTooltip';
import { TAB_ORDER, chartChrome, humanize, tabColorHex, useIsDark } from './colors';
import { isAllZero, recordToBuckets } from './utils';

export function TabDonutChart({
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
  const buckets = recordToBuckets(data, TAB_ORDER);
  const total = buckets.reduce((sum, b) => sum + b.value, 0);
  const rows = buckets.map((b) => ({ ...b, label: humanize(b.key), fill: tabColorHex(isDark, b.key) }));

  return (
    <ChartShell
      title="Samples by tab"
      subtitle="Specialty / Bulk / Forwarding"
      loading={loading}
      isEmpty={isAllZero(buckets)}
      emptyMessage="No samples yet"
      motionDelayMs={motionDelayMs}
    >
      <div className="flex h-full items-center gap-4">
        <div className="h-full min-w-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip content={<ChartTooltip chrome={chrome} formatter={(v) => `${v.toLocaleString()} (${total ? Math.round((v / total) * 100) : 0}%)`} />} />
              <Pie
                data={rows}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius="58%"
                outerRadius="88%"
                paddingAngle={2}
                isAnimationActive={false}
                label={({ percent }) => (percent && percent > 0.06 ? `${Math.round(percent * 100)}%` : '')}
                labelLine={false}
              >
                {rows.map((row) => (
                  <Cell key={row.key} fill={row.fill} stroke="transparent" />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Direct legend — identity is carried by this label list, never by the
            slice color alone (2 of the 3 donut hues sit below 3:1 contrast on the
            light card surface; the dataviz skill's relief rule requires this). */}
        <ul className="flex shrink-0 flex-col gap-2">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-2 text-xs">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.fill }} />
              <span className="capitalize text-foreground">{row.label}</span>
              <span className="tabular-nums text-muted-foreground">{row.value.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartShell>
  );
}
