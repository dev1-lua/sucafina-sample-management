import { useMemo, useState } from 'react';
import { IconX } from '@tabler/icons-react';

import { KpiTile } from '@/components/KpiTile';
import { ChaserSummaryCard } from '@/components/ChaserSummaryCard';
import { FilterBar } from '@/components/FilterBar';
import { Button } from '@/components/ui/button';
import { ApprovalRateChart } from '@/components/charts/ApprovalRateChart';
import { CountryBarChart } from '@/components/charts/CountryBarChart';
import { CourierBarChart } from '@/components/charts/CourierBarChart';
import { SampleTypeBarChart } from '@/components/charts/SampleTypeBarChart';
import { StatusBarChart } from '@/components/charts/StatusBarChart';
import { TabDonutChart } from '@/components/charts/TabDonutChart';
import { VolumeAreaChart } from '@/components/charts/VolumeAreaChart';
import { useStats } from '@/lib/query';
import { dashboardFilterDefs } from '@/lib/dashboard-filters';
import { cn } from '@/lib/cn';
import type { FilterState } from '@/types';

const KPI_STAGGER_MS = 40;
const CHART_STAGGER_MS = 60;
const CHART_BASE_DELAY_MS = 7 * KPI_STAGGER_MS; // charts settle in just after the KPI row finishes

export default function DashboardPage() {
  const [filters, setFilters] = useState<FilterState>({});
  // `isLoading` is only true on the very first load — with keepPreviousData it stays
  // false across filter changes, so the charts never unmount (freeze safeguard). We
  // use `isFetching` purely to dim the stats-driven blocks while a re-filter loads.
  const { data: stats, isLoading, isFetching, isError } = useStats(filters);

  const filterDefs = useMemo(
    () => dashboardFilterDefs(stats?.months ?? [], stats?.countries ?? [], stats?.qualities ?? []),
    [stats?.months, stats?.countries, stats?.qualities],
  );
  const hasFilters = Object.keys(filters).length > 0;
  const refetching = isFetching && !isLoading;

  const totalSamples = stats ? Object.values(stats.by_tab).reduce((sum, n) => sum + n, 0) : 0;
  const approvalRatePct = stats?.approval_rate == null ? null : Math.round(stats.approval_rate * 100);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* No page-level "Dashboard" title here: the Header bar already renders it as the
          section title (like every other route), so repeating it would duplicate the h1. */}
      <p className="text-xs text-muted-foreground">
        Live view across specialty, commercial, and forwarding samples.
        {isError && <span className="ml-1 text-destructive">Couldn't load the latest stats — showing what's cached.</span>}
      </p>

      {/* Filter toolbar — slices every KPI + chart below. Reuses the list pages'
          FilterBar (no-Radix popover); search box hidden (no `q` on /stats). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterBar defs={filterDefs} value={filters} onChange={setFilters} showSearch={false} />
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => setFilters({})}>
            <IconX className="size-3.5" /> Clear all
          </Button>
        )}
      </div>

      {/* KPI Row */}
      <div className={cn('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 transition-opacity duration-150', refetching && 'opacity-60')}>
        <KpiTile
          label="Total samples"
          value={totalSamples.toLocaleString()}
          loading={isLoading}
          motionDelayMs={0 * KPI_STAGGER_MS}
        />
        <KpiTile
          label="Dispatched"
          value={(stats?.in_transit ?? 0).toLocaleString()}
          hint="Delivery not confirmed"
          loading={isLoading}
          motionDelayMs={1 * KPI_STAGGER_MS}
        />
        <KpiTile
          label="Awaiting results"
          value={(stats?.awaiting_results ?? 0).toLocaleString()}
          loading={isLoading}
          motionDelayMs={2 * KPI_STAGGER_MS}
        />
        <KpiTile
          label="Aging >7d"
          value={(stats?.awaiting_results_aging ?? 0).toLocaleString()}
          hint="Awaiting results, requested 7+ days ago"
          loading={isLoading}
          motionDelayMs={3 * KPI_STAGGER_MS}
        />
        <KpiTile
          label="Dispatched this week"
          value={(stats?.dispatched_this_week ?? 0).toLocaleString()}
          loading={isLoading}
          motionDelayMs={4 * KPI_STAGGER_MS}
        />
        <KpiTile
          label="Approval rate"
          value={approvalRatePct == null ? '—' : `${approvalRatePct}%`}
          hint="Approved share of decided samples"
          loading={isLoading}
          motionDelayMs={5 * KPI_STAGGER_MS}
        />
        <KpiTile
          label="Avg feedback time"
          value={stats?.avg_feedback_days == null ? '—' : `${stats.avg_feedback_days}d`}
          hint="Delivered → cupping result"
          loading={isLoading}
          motionDelayMs={6 * KPI_STAGGER_MS}
        />
      </div>

      {/* Chaser follow-ups at a glance — links to the full Chaser tab. */}
      <ChaserSummaryCard />

      {/* Charts */}
      <div className={cn('grid grid-cols-1 lg:grid-cols-2 gap-3 transition-opacity duration-150', refetching && 'opacity-60')}>
        <StatusBarChart data={stats?.by_status} loading={isLoading} motionDelayMs={CHART_BASE_DELAY_MS + 0 * CHART_STAGGER_MS} />
        <VolumeAreaChart data={stats?.volume_over_time} loading={isLoading} motionDelayMs={CHART_BASE_DELAY_MS + 1 * CHART_STAGGER_MS} />
        <TabDonutChart data={stats?.by_tab} loading={isLoading} motionDelayMs={CHART_BASE_DELAY_MS + 2 * CHART_STAGGER_MS} />
        <SampleTypeBarChart data={stats?.by_sample_type} loading={isLoading} motionDelayMs={CHART_BASE_DELAY_MS + 3 * CHART_STAGGER_MS} />
        <ApprovalRateChart data={stats?.approval_by_type} loading={isLoading} motionDelayMs={CHART_BASE_DELAY_MS + 4 * CHART_STAGGER_MS} />
        <CourierBarChart data={stats?.by_courier} loading={isLoading} motionDelayMs={CHART_BASE_DELAY_MS + 5 * CHART_STAGGER_MS} />
        <CountryBarChart data={stats?.by_country} loading={isLoading} motionDelayMs={CHART_BASE_DELAY_MS + 6 * CHART_STAGGER_MS} />
      </div>
    </div>
  );
}
