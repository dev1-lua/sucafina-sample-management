import { KpiTile } from '@/components/KpiTile';
import { ChartShell } from '@/components/charts/ChartShell';

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Note about Phase 4 */}
      <p className="text-xs text-muted-foreground">
        Live metrics arrive in Phase 4
      </p>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="In transit" value="—" />
        <KpiTile label="Awaiting results" value="—" />
        <KpiTile label="Dispatched this week" value="—" />
        <KpiTile label="Total samples" value="—" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartShell title="By status" />
        <ChartShell title="Volume over time" />
      </div>
    </div>
  );
}
