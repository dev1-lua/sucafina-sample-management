import React from 'react';

import { Skeleton } from '@/components/ui/skeleton';

export function KpiTile({
  label,
  value,
  hint,
  loading,
  motionDelayMs,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  /** True while the underlying query is fetching — shows a skeleton bar in place
   * of the value/hint instead of the caller having to pass a "—" placeholder. */
  loading?: boolean;
  /** Staggers this tile's mount fade-in relative to its siblings (ms). */
  motionDelayMs?: number;
}) {
  return (
    <div
      className="animate-fade-in rounded-lg border border-border bg-card p-4"
      style={motionDelayMs ? { animationDelay: `${motionDelayMs}ms`, animationFillMode: 'backwards' } : undefined}
    >
      <div className="text-xs font-medium uppercase text-muted-foreground tracking-wide">
        {label}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-16" />
      ) : (
        <div className="mt-2 text-2xl font-semibold text-foreground">{value}</div>
      )}
      {hint && !loading && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
