import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { ChartShell } from './ChartShell';
import { SAMPLE_TYPE_ORDER, chartChrome, colorForSampleType, humanize, useIsDark } from './colors';
import type { ChartChrome } from './colors';

export type ApprovalByType = Record<string, { approved: number; rejected: number; total: number; rate: number | null }>;

type Row = { key: string; label: string; pct: number; approved: number; total: number };

/** Feedback ⑮: approval rate per sample type (Offer / Type / PSS / …). Bars show the approved
 * share of *decided* samples (approved + rejected; pending excluded). Types with no decided
 * samples are dropped rather than drawn as an ambiguous 0%. */
export function ApprovalRateChart({
  data,
  loading,
  motionDelayMs,
}: {
  data?: ApprovalByType;
  loading?: boolean;
  motionDelayMs?: number;
}) {
  const isDark = useIsDark();
  const chrome = chartChrome(isDark);

  const rec = data ?? {};
  const orderedKeys = [
    ...SAMPLE_TYPE_ORDER.filter((k) => k in rec),
    ...Object.keys(rec).filter((k) => !SAMPLE_TYPE_ORDER.includes(k as (typeof SAMPLE_TYPE_ORDER)[number])),
  ];
  const rows: Row[] = orderedKeys
    .map((key) => {
      const d = rec[key];
      return { key, label: humanize(key), pct: d.rate == null ? 0 : Math.round(d.rate * 100), approved: d.approved, total: d.total };
    })
    .filter((r) => r.total > 0);

  return (
    <ChartShell
      title="Approval rate by type"
      subtitle="Approved share of decided samples (approved + rejected)"
      loading={loading}
      isEmpty={rows.length === 0}
      emptyMessage="No cupping verdicts yet"
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
          <YAxis
            domain={[0, 100]}
            tick={{ fill: chrome.tick, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={36}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip cursor={{ fill: chrome.grid, opacity: 0.5 }} content={<ApprovalTooltip chrome={chrome} rows={rows} />} />
          <Bar dataKey="pct" name="approval" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell key={row.key} fill={colorForSampleType(row.key)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}

/** Custom tooltip so the hover shows the underlying counts ("3 of 4 approved — 75%"), which a
 * bare percentage bar can't convey. Matches the shared ChartTooltip's card/border chrome. */
function ApprovalTooltip({
  active,
  label,
  chrome,
  rows,
}: {
  active?: boolean;
  label?: string | number;
  chrome: ChartChrome;
  rows: Row[];
}) {
  if (!active) return null;
  const row = rows.find((r) => r.label === label);
  if (!row) return null;
  return (
    <div
      className="rounded-md border px-2.5 py-1.5 text-xs shadow-sm"
      style={{ backgroundColor: chrome.tooltipBg, borderColor: chrome.tooltipBorder, color: chrome.text }}
    >
      <div className="mb-1 font-medium capitalize">{row.label}</div>
      <div className="tabular-nums">
        {row.approved} of {row.total} approved — <span className="font-medium">{row.pct}%</span>
      </div>
    </div>
  );
}
