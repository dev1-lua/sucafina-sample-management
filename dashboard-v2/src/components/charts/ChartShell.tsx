import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { Skeleton } from '@/components/ui/skeleton';

export type ChartShellProps = {
  title: string;
  /** Small muted line under the title — e.g. a unit or a "top 15" qualifier. */
  subtitle?: string;
  /** True while the underlying query is fetching — shows a skeleton in place of
   * the plot area (children are not rendered). */
  loading?: boolean;
  /** True when the data resolved but every value is zero / the group is empty —
   * shows `emptyMessage` instead of an empty plot. */
  isEmpty?: boolean;
  emptyMessage?: string;
  /** Plot area height in px. Recharts' `ResponsiveContainer` needs a concrete
   * pixel height from its parent rather than a percentage one, so this is set
   * here once and threaded down instead of every chart guessing at an aspect
   * ratio. */
  height?: number;
  /** Rendered top-right of the header — e.g. a legend or a total count. */
  corner?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Staggers this tile's mount fade-in relative to its siblings (ms). */
  motionDelayMs?: number;
};

export function ChartShell({
  title,
  subtitle,
  loading,
  isEmpty,
  emptyMessage = 'No data yet',
  height = 260,
  corner,
  children,
  className,
  motionDelayMs,
}: ChartShellProps) {
  return (
    <div
      className={cn('animate-fade-in rounded-lg border border-border bg-card p-4', className)}
      style={motionDelayMs ? { animationDelay: `${motionDelayMs}ms`, animationFillMode: 'backwards' } : undefined}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {corner && !loading && <div className="shrink-0">{corner}</div>}
      </div>

      <div style={{ height }} className="w-full">
        {loading ? (
          <Skeleton className="h-full w-full" />
        ) : isEmpty ? (
          <div className="flex h-full items-center justify-center rounded-md bg-secondary/20">
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
