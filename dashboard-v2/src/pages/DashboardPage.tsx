import { KpiTile } from '@/components/KpiTile';
import { CountryBarChart } from '@/components/charts/CountryBarChart';
import { CourierBarChart } from '@/components/charts/CourierBarChart';
import { SampleTypeBarChart } from '@/components/charts/SampleTypeBarChart';
import { StatusBarChart } from '@/components/charts/StatusBarChart';
import { TabDonutChart } from '@/components/charts/TabDonutChart';
import { VolumeAreaChart } from '@/components/charts/VolumeAreaChart';
import { useStats } from '@/lib/query';

const KPI_STAGGER_MS = 40;
const CHART_STAGGER_MS = 60;
const CHART_BASE_DELAY_MS = 5 * KPI_STAGGER_MS; // charts settle in just after the KPI row finishes

export default function DashboardPage() {
  const { data: stats, isLoading, isError } = useStats();

  const totalSamples = stats ? Object.values(stats.by_tab).reduce((sum, n) => sum + n, 0) : 0;

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* No page-level "Dashboard" title here: the Header bar already renders it as the
          section title (like every other route), so repeating it would duplicate the h1. */}
      <p className="text-xs text-muted-foreground">
        Live view across specialty, bulk, and forwarding samples.
        {isError && <span className="ml-1 text-destructive">Couldn't load the latest stats — showing what's cached.</span>}
      </p>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiTile
          label="Total samples"
          value={totalSamples.toLocaleString()}
          loading={isLoading}
          motionDelayMs={0 * KPI_STAGGER_MS}
        />
        <KpiTile
          label="In transit"
          value={(stats?.in_transit ?? 0).toLocaleString()}
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
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <StatusBarChart data={stats?.by_status} loading={isLoading} motionDelayMs={CHART_BASE_DELAY_MS + 0 * CHART_STAGGER_MS} />
        <VolumeAreaChart data={stats?.volume_over_time} loading={isLoading} motionDelayMs={CHART_BASE_DELAY_MS + 1 * CHART_STAGGER_MS} />
        <TabDonutChart data={stats?.by_tab} loading={isLoading} motionDelayMs={CHART_BASE_DELAY_MS + 2 * CHART_STAGGER_MS} />
        <SampleTypeBarChart data={stats?.by_sample_type} loading={isLoading} motionDelayMs={CHART_BASE_DELAY_MS + 3 * CHART_STAGGER_MS} />
        <CourierBarChart data={stats?.by_courier} loading={isLoading} motionDelayMs={CHART_BASE_DELAY_MS + 4 * CHART_STAGGER_MS} />
        <CountryBarChart data={stats?.by_country} loading={isLoading} motionDelayMs={CHART_BASE_DELAY_MS + 5 * CHART_STAGGER_MS} />
      </div>
    </div>
  );
}
