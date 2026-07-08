import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { ChartShell } from './ChartShell';
import { ChartTooltip } from './ChartTooltip';
import { PRIMARY_HEX, chartChrome, useIsDark } from './colors';

function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  const idx = Number(m) - 1;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[idx] ? `${names[idx]} ${y?.slice(2)}` : month;
}

export function VolumeAreaChart({
  data,
  loading,
  motionDelayMs,
}: {
  data?: { month: string; n: number }[];
  loading?: boolean;
  motionDelayMs?: number;
}) {
  const isDark = useIsDark();
  const chrome = chartChrome(isDark);
  const rows = (data ?? []).map((d) => ({ month: d.month, label: monthLabel(d.month), n: d.n }));
  const isEmpty = rows.length === 0 || rows.every((r) => !r.n);

  return (
    <ChartShell
      title="Volume over time"
      subtitle="Samples dispatched per month"
      loading={loading}
      isEmpty={isEmpty}
      emptyMessage="No volume history yet"
      motionDelayMs={motionDelayMs}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="volumeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PRIMARY_HEX} stopOpacity={0.32} />
              <stop offset="100%" stopColor={PRIMARY_HEX} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={chrome.grid} vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tick={{ fill: chrome.tick, fontSize: 11 }}
            axisLine={{ stroke: chrome.axis }}
            tickLine={false}
            minTickGap={16}
          />
          <YAxis allowDecimals={false} tick={{ fill: chrome.tick, fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
          <Tooltip
            cursor={{ stroke: chrome.axis, strokeWidth: 1 }}
            content={<ChartTooltip chrome={chrome} />}
          />
          <Area
            type="monotone"
            dataKey="n"
            name="samples"
            stroke={PRIMARY_HEX}
            strokeWidth={2}
            fill="url(#volumeFill)"
            isAnimationActive={false}
            dot={{ r: 3, fill: PRIMARY_HEX, strokeWidth: 0 }}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
