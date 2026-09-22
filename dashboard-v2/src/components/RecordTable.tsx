import * as React from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
  type ExpandedState,
  type VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconChevronUp, IconChevronDown, IconChevronRight, IconSelector } from '@tabler/icons-react';

import { useRecords } from '@/lib/query';
import { cn } from '@/lib/cn';
import type { ColumnDef, FilterState, SortState } from '@/types';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 50;
const ROW_HEIGHT = 32;
const SKELETON_ROWS = 8;
// Every column gets a real px width so the grid stops splitting the viewport into
// unreadable slivers (the AWB-column bug); when the total exceeds the viewport the
// scroll container pans horizontally, like Twenty's spreadsheet grid.
const DEFAULT_COL_WIDTH = 150;
// The leading chevron column of an expandable table (round 10, Coffees view).
const EXPAND_COL_WIDTH = 36;

/** Header sort affordance. Every sortable column shows a faint up/down hint so it
 * reads as sortable at a glance; the active column shows a solid single chevron in
 * the current direction. Icons are aria-hidden — <TableHead aria-sort> conveys the
 * state to assistive tech. Purely presentational; lives in the sticky header, never
 * the virtualized body, so it's outside the freeze vector. */
function SortIndicator({ active, order }: { active: boolean; order?: 'asc' | 'desc' }) {
  if (active) {
    const Icon = order === 'asc' ? IconChevronUp : IconChevronDown;
    return <Icon className="size-3.5 shrink-0 text-foreground" aria-hidden="true" />;
  }
  return <IconSelector className="size-3.5 shrink-0 opacity-40" aria-hidden="true" />;
}

type RowData = Record<string, unknown>;

/**
 * Parent → child rows (round 10, the Coffees view). The caller owns the expanded set and
 * supplies each parent's children (loaded on expand — the table never fetches them);
 * children render as ONE full-width cell per row so every row, parent or child, keeps the
 * fixed ROW_HEIGHT the virtualizer estimates with. Deep detail stays in the side panel.
 */
export type ExpandableConfig = {
  expanded: Record<string, boolean>; // parent row id → expanded (controlled)
  onExpandedChange: (next: Record<string, boolean>) => void;
  getSubRows: (row: RowData) => RowData[]; // children to nest under a parent right now ([] while collapsed)
  renderSubRow: (sub: RowData, parent: RowData) => React.ReactNode; // the child row's single-cell content
  onSubRowClick?: (sub: RowData, parent: RowData) => void;
  expandLabel?: (row: RowData) => string; // accessible name of the chevron, e.g. "Expand SL-7336"
};

export type RecordTableProps = {
  endpoint: string;
  columns: ColumnDef[];
  filters: FilterState;
  onRowClick: (row: RowData) => void;
  // Controlled column show/hide (see ColumnMenu.useColumnVisibility). Omitted => every
  // column renders, matching pre-Phase-4 behavior and RecordTable.test.tsx's usage.
  columnVisibility?: VisibilityState;
  // Record id to flash once when landing from an agent deep-link (see useRowHighlight).
  highlightId?: string;
  // Whether column headers are clickable to sort. Defaults to true. Temporarily set
  // false by the list pages while the filter/sort-triggered page-freeze is investigated.
  sortable?: boolean;
  // Sort applied on first render (null => the API's own default). Header clicks override it.
  initialSort?: SortState;
  // Round 10: nest child rows under each parent (see ExpandableConfig).
  expandable?: ExpandableConfig;
  // Row identity (defaults to `row.id`); lots are keyed by `ref`.
  rowId?: (row: RowData) => string;
  // Footer count wording; defaults to "N record(s)".
  countLabel?: (total: number) => string;
};

const columnHelper = createColumnHelper<RowData>();

// Frozen-right column treatment. A sticky cell needs its own opaque background (row
// content pans beneath it), which hides the tr-level hover tint and deep-link flash —
// both are replicated on the cell via arbitrary variants. The seam is an inset shadow,
// not a border: border-collapse swallows borders on sticky cells while scrolling.
const PINNED_CELL =
  'sticky right-0 bg-background shadow-[inset_1px_0_0_hsl(var(--border))]';
const PINNED_BODY_CELL = cn(
  PINNED_CELL,
  'z-[1] [tr:hover>&]:bg-muted [tr.animate-row-flash>&]:animate-row-flash',
);
const PINNED_HEADER_CELL = cn(PINNED_CELL, 'z-20');

function displayValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">—</span>;
  }
  return String(value);
}

export function RecordTable({ endpoint, columns, filters, onRowClick, columnVisibility, highlightId, sortable = true, initialSort = null, expandable, rowId, countLabel }: RecordTableProps) {
  const [sort, setSort] = React.useState<SortState>(initialSort);
  const [page, setPage] = React.useState(1);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Reset to page 1 whenever the caller's filters change (stable serialization
  // so equivalent filter objects with a new reference don't churn pagination).
  const filtersKey = React.useMemo(() => JSON.stringify(filters), [filters]);
  React.useEffect(() => {
    setPage(1);
  }, [filtersKey]);

  const query = useRecords(endpoint, { sort, filters, page, pageSize: PAGE_SIZE });
  const rows = query.data?.data ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // One-shot row flash when landing from an agent deep-link. Armed only once the
  // target row is actually in the loaded page — otherwise a cold deep-link load
  // (list still fetching) would burn the whole animation window before the row ever
  // renders. The scroll-into-view effect below runs off the same signal, so the row
  // is on-screen while it pulses.
  const [flashId, setFlashId] = React.useState<string>();
  const highlightPresent = !!highlightId && rows.some((r) => (r as RowData).id === highlightId);
  React.useEffect(() => {
    if (!highlightId || !highlightPresent) return;
    setFlashId(highlightId);
    const t = setTimeout(() => setFlashId(undefined), 2200);
    return () => clearTimeout(t);
  }, [highlightId, highlightPresent]);

  const colByKey = React.useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  // Same visibility predicate TanStack Table applies internally — kept in sync here so
  // the loading-skeleton and empty/error colSpans match the actually-rendered column
  // count instead of always assuming every column is shown.
  const visibleColumns = React.useMemo(
    () => columns.filter((c) => columnVisibility?.[c.key] !== false),
    [columns, columnVisibility],
  );

  const tableColumns = React.useMemo(
    () =>
      columns.map((col) =>
        columnHelper.accessor((row) => row[col.key], {
          id: col.key,
          header: col.header,
          cell: (ctx) => {
            const rowData = ctx.row.original;
            if (col.render) return col.render(rowData);
            return displayValue(rowData[col.key]);
          },
        }),
      ),
    [columns],
  );

  // Expandable: attach each parent's current children as `subRows` so TanStack's expanded
  // row model flattens them into the row list (one fixed-height row each).
  const getSubRows = expandable?.getSubRows;
  const data = React.useMemo(
    () => (getSubRows ? rows.map((r) => ({ ...r, subRows: getSubRows(r) })) : rows),
    [rows, getSubRows],
  );
  const onExpandedChange = expandable?.onExpandedChange;
  const handleExpandedChange = React.useCallback(
    (updater: ExpandedState | ((prev: ExpandedState) => ExpandedState)) => {
      if (!onExpandedChange) return;
      const prev: ExpandedState = expandable?.expanded ?? {};
      const next = typeof updater === 'function' ? updater(prev) : updater;
      // `true` (expand-all) is never produced by our chevrons; keep the record shape.
      onExpandedChange(next === true ? {} : next);
    },
    [onExpandedChange, expandable?.expanded],
  );

  const table = useReactTable({
    data,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getSubRows: expandable ? (row) => (row as RowData & { subRows?: RowData[] }).subRows : undefined,
    getRowCanExpand: expandable ? (row) => row.depth === 0 : () => false,
    // Children get a parent-scoped id so the same send can never collide with a parent id.
    getRowId: (row, index, parent) =>
      parent ? `${parent.id}:${String(row.id ?? index)}` : rowId ? rowId(row) : String(row.id),
    state: { columnVisibility: columnVisibility ?? {}, expanded: expandable?.expanded ?? {} },
    onExpandedChange: handleExpandedChange,
  });

  const tableRows = table.getRowModel().rows;

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // Bring the deep-linked row into view. The virtualizer won't render (let alone
  // scroll to) an off-screen row on its own, so a match below the fold — or anywhere
  // past the initial overscan — would flash invisibly. No-op when the row isn't on the
  // current page (the opened drawer + banner still convey the change). Runs once rows
  // arrive: on a fresh deep-link `highlightId` is set before the query resolves, so we
  // also key on the row count so it fires when the data lands.
  React.useEffect(() => {
    if (!highlightId) return;
    const index = tableRows.findIndex((r) => r.id === highlightId);
    if (index >= 0) rowVirtualizer.scrollToIndex(index, { align: 'center' });
    // rowVirtualizer is stable; the meaningful inputs are the target id and whether the
    // current page's rows are loaded yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId, tableRows.length]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0]!.start : 0;
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1]!.end : 0;

  // Three-state cycle per column: unsorted → ascending → descending → unsorted.
  // The third click clears the sort back to the API default (date_on desc), so a
  // column sort is dismissable without reloading the page.
  function handleSort(col: ColumnDef) {
    if (!col.sortKey) return;
    setSort((prev) => {
      if (!prev || prev.sort !== col.sortKey) return { sort: col.sortKey!, order: 'asc' };
      if (prev.order === 'asc') return { sort: col.sortKey!, order: 'desc' };
      return null; // was descending → clear
    });
  }

  const colCount = visibleColumns.length + (expandable ? 1 : 0);
  const tableWidth =
    visibleColumns.reduce((sum, c) => sum + (c.width ?? DEFAULT_COL_WIDTH), 0) + (expandable ? EXPAND_COL_WIDTH : 0);
  const isLoading = query.isLoading;
  const isEmpty = !isLoading && !query.isError && rows.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={scrollRef}
        className={cn(
          'max-h-[70vh] overflow-auto rounded-[4px] border border-border transition-opacity duration-150',
          query.isFetching && !isLoading && 'opacity-60',
        )}
      >
        <table className="min-w-full table-fixed caption-bottom text-sm" style={{ width: tableWidth }}>
          <TableHeader className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {expandable && <TableHead style={{ width: EXPAND_COL_WIDTH }} aria-label="Expand" />}
                {headerGroup.headers.map((header) => {
                  const col = colByKey.get(header.column.id)!;
                  const isSortable = !!col.sortKey && sortable;
                  const isActive = isSortable && sort?.sort === col.sortKey;
                  return (
                    <TableHead
                      key={header.id}
                      style={{ width: col.width ?? DEFAULT_COL_WIDTH }}
                      className={cn(
                        'whitespace-nowrap text-xs uppercase tracking-wide text-muted-foreground',
                        isSortable && 'cursor-pointer select-none hover:text-foreground',
                        col.pinned === 'right' && PINNED_HEADER_CELL,
                      )}
                      onClick={isSortable ? () => handleSort(col) : undefined}
                      tabIndex={isSortable ? 0 : undefined}
                      onKeyDown={
                        isSortable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleSort(col);
                              }
                            }
                          : undefined
                      }
                      aria-sort={isActive ? (sort?.order === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {isSortable && <SortIndicator active={!!isActive} order={sort?.order} />}
                      </span>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <TableRow key={`skeleton-${i}`} className="hover:bg-transparent">
                  {expandable && <TableCell />}
                  {visibleColumns.map((col) => (
                    <TableCell key={col.key}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

            {!isLoading && query.isError && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount} className="h-24 text-center text-muted-foreground">
                  Failed to load records.
                </TableCell>
              </TableRow>
            )}

            {isEmpty && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colCount} className="h-24 text-center text-muted-foreground">
                  No records
                </TableCell>
              </TableRow>
            )}

            {!isLoading && !query.isError && !isEmpty && (
              <>
                {paddingTop > 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={colCount} style={{ height: paddingTop, padding: 0 }} />
                  </TableRow>
                )}
                {virtualItems.map((virtualItem) => {
                  const row = tableRows[virtualItem.index]!;
                  if (expandable && row.depth > 0) {
                    const parent = row.getParentRow()!.original;
                    return (
                      <TableRow
                        key={row.id}
                        className={cn('bg-muted/30', expandable.onSubRowClick && 'cursor-pointer')}
                        onClick={expandable.onSubRowClick ? () => expandable.onSubRowClick!(row.original, parent) : undefined}
                      >
                        <TableCell colSpan={colCount} className="py-0">
                          {expandable.renderSubRow(row.original, parent)}
                        </TableCell>
                      </TableRow>
                    );
                  }
                  return (
                    <TableRow
                      key={row.id}
                      className={cn('cursor-pointer', row.id === flashId && 'animate-row-flash')}
                      onClick={() => onRowClick(row.original)}
                    >
                      {expandable && (
                        <TableCell style={{ width: EXPAND_COL_WIDTH }} className="px-1 py-0">
                          <button
                            type="button"
                            aria-expanded={row.getIsExpanded()}
                            aria-label={expandable.expandLabel?.(row.original) ?? 'Expand'}
                            onClick={(e) => {
                              e.stopPropagation();
                              row.toggleExpanded();
                            }}
                            className="inline-flex size-7 items-center justify-center rounded-[4px] text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <IconChevronRight
                              className={cn('size-4 transition-transform duration-150', row.getIsExpanded() && 'rotate-90')}
                              aria-hidden="true"
                            />
                          </button>
                        </TableCell>
                      )}
                      {row.getVisibleCells().map((cell) => {
                        const col = colByKey.get(cell.column.id)!;
                        return (
                          <TableCell
                            key={cell.id}
                            style={{ width: col.width ?? DEFAULT_COL_WIDTH }}
                            className={cn('truncate', col.pinned === 'right' && PINNED_BODY_CELL)}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
                {paddingBottom > 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={colCount} style={{ height: paddingBottom, padding: 0 }} />
                  </TableRow>
                )}
              </>
            )}
          </TableBody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{countLabel ? countLabel(total) : `${total} record${total === 1 ? '' : 's'}`}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span>
            Page {page} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
