export function ChartShell({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground mb-3">{title}</h3>
      <div className="flex items-center justify-center aspect-video rounded-md bg-secondary/20">
        <div className="text-sm text-muted-foreground">Chart — Phase 4</div>
      </div>
    </div>
  );
}
