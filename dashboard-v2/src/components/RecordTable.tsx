import * as React from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

import { usePatchRecord, useRecords } from '@/lib/query';
import { cn } from '@/lib/cn';
import type { ColumnDef, FilterState, SortState } from '@/types';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 50;
const ROW_HEIGHT = 32;
const SKELETON_ROWS = 8;

type RowData = Record<string, unknown>;

export type RecordTableProps = {
  endpoint: string;
  columns: ColumnDef[];
  filters: FilterState;
  onRowClick: (row: RowData) => void;
};

const columnHelper = createColumnHelper<RowData>();

function displayValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">—</span>;
  }
  return String(value);
}

function InlineEditCell({
  editDef,
  row,
  onCommit,
}: {
  editDef: NonNullable<ColumnDef['edit']>;
  row: RowData;
  onCommit: (field: string, value: string) => void;
}) {
  const initial = row[editDef.field];
  const initialStr = initial === null || initial === undefined ? '' : String(initial);
  const [value, setValue] = React.useState(initialStr);

  React.useEffect(() => {
    setValue(initialStr);
  }, [initialStr]);

  function commit(next: string) {
    if (next !== initialStr) onCommit(editDef.field, next);
  }

  if (editDef.type === 'select') {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <Select
          value={value}
          onValueChange={(next) => {
            setValue(next);
            commit(next);
          }}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(editDef.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Input
        className="h-7 text-xs"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => commit(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

export function RecordTable({ endpoint, columns, filters, onRowClick }: RecordTableProps) {
  const [sort, setSort] = React.useState<SortState>(null);
  const [page, setPage] = React.useState(1);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const { mutate: patchRecord } = usePatchRecord(endpoint);

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

  const colByKey = React.useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  const commitEdit = React.useCallback(
    (id: unknown, field: string, value: string) => {
      patchRecord({ id: String(id), body: { [field]: value } });
    },
    [patchRecord],
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
            if (col.edit) {
              return (
                <InlineEditCell
                  editDef={col.edit}
                  row={rowData}
                  onCommit={(field, value) => commitEdit(rowData.id, field, value)}
                />
              );
            }
            return displayValue(rowData[col.key]);
          },
        }),
      ),
    [columns, commitEdit],
  );

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
  });

  const tableRows = table.getRowModel().rows;

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0]!.start : 0;
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1]!.end : 0;

  function handleSort(col: ColumnDef) {
    if (!col.sortKey) return;
    setSort((prev) => {
      if (!prev || prev.sort !== col.sortKey) return { sort: col.sortKey!, order: 'asc' };
      return { sort: col.sortKey!, order: prev.order === 'asc' ? 'desc' : 'asc' };
    });
  }

  const colCount = columns.length;
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
        <table className="w-full caption-bottom text-sm">
          <TableHeader className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const col = colByKey.get(header.column.id)!;
                  const isSortable = !!col.sortKey;
                  const isActive = isSortable && sort?.sort === col.sortKey;
                  return (
                    <TableHead
                      key={header.id}
                      style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                      className={cn(
                        'text-xs uppercase tracking-wide text-muted-foreground',
                        isSortable && 'cursor-pointer select-none hover:text-foreground',
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
                        {isActive && <span aria-hidden="true">{sort?.order === 'asc' ? '↑' : '↓'}</span>}
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
                  {columns.map((col) => (
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
                  return (
                    <TableRow key={row.id} className="cursor-pointer" onClick={() => onRowClick(row.original)}>
                      {row.getVisibleCells().map((cell) => {
                        const col = colByKey.get(cell.column.id)!;
                        return (
                          <TableCell
                            key={cell.id}
                            style={col.width ? { width: col.width, minWidth: col.width } : undefined}
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
        <span>
          {total} record{total === 1 ? '' : 's'}
        </span>
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
