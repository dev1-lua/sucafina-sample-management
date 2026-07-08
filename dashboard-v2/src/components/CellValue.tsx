// Shared read-only cell renderer for tab column configs. Mirrors RecordTable's/
// DetailDrawer's own private `displayValue` (em-dash for empty) but also exposed here
// for tab configs (specialty/bulk/forwarding) that need a plain-text `render` — e.g.
// a column whose display value lives on a *different* field than its `key` (courier
// columns display `courier_norm`, the only field the API ever writes; the raw
// `courier` column is legacy-import-only and never populated by this app).
export function CellValue({ value, humanize }: { value: unknown; humanize?: boolean }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">—</span>;
  }
  const str = String(value);
  return <>{humanize ? str.replace(/_/g, ' ') : str}</>;
}
