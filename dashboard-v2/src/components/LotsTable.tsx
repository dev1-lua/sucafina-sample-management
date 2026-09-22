import * as React from 'react';
import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';

import { RecordTable } from '@/components/RecordTable';
import { CellValue } from '@/components/CellValue';
import { StatusBadge } from '@/components/StatusBadge';
import { LOTS_ENDPOINT, useLotSendsMany, type LotBook, type LotSend } from '@/lib/query';
import { formatQty } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { ColumnDef, FilterState } from '@/types';

type RowData = Record<string, unknown>;
type SortDir = 'asc' | 'desc';

/** The rows nested under an expanded coffee besides its sends: a state line or the child header. */
type Placeholder = { __placeholder: 'loading' | 'error' | 'header'; id: string };
const isPlaceholder = (row: RowData): row is Placeholder & RowData => typeof row.__placeholder === 'string';

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** "08KN0021 · AB · KII/KIRINYAGA" (specialty: outturn · grade · description) or "AB FAQ · Blend" (commercial). */
export function lotCoffeeLabel(lot: RowData, book: LotBook): string | null {
  const parts = book === 'specialty' ? [lot.outturn, lot.grade, lot.quality] : [lot.quality, lot.blend];
  const present = parts.map(text).filter((p): p is string => p !== null);
  return present.length ? present.join(' · ') : null;
}

function columnsFor(book: LotBook): ColumnDef[] {
  return [
    { key: 'ref', header: 'Ref', sortKey: 'ref', width: 120 },
    {
      key: 'coffee',
      header: 'Coffee',
      sortKey: book === 'specialty' ? 'outturn' : 'quality',
      width: 260,
      render: (r) => <CellValue value={lotCoffeeLabel(r, book)} />,
    },
    { key: 'sends', header: 'Sends', sortKey: 'sends', width: 80 },
    { key: 'status_rollup', header: 'Status', width: 200 },
    { key: 'last_send_on', header: 'Last send', sortKey: 'last_send_on', width: 110, render: (r) => <CellValue value={text(r.last_send_on)?.slice(0, 10)} /> },
    { key: 'last_receiver', header: 'Last receiver', sortKey: 'last_receiver', width: 180 },
  ];
}

// Child rows share one grid so the columns line up under every expanded coffee.
const CHILD_GRID = 'grid h-8 grid-cols-[100px_minmax(0,1fr)_72px_160px_130px_100px] items-center gap-3 pl-7 pr-2 text-xs';

function sendTime(s: LotSend): number {
  const t = s.date_on ? Date.parse(s.date_on) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

export type LotsTableProps = {
  book: LotBook;
  // The list page's FilterState. Only free text applies to lots: `q` (or the `ref` deep-link
  // filter) goes to the server as `q`, which also matches any send's receiver.
  filters: FilterState;
  // `?ref=` on load: open this coffee straight away.
  initialExpandedRef?: string | null;
  onSendClick: (send: LotSend) => void;
};

/**
 * Coffees view (round 10): one row per ref with its sends nested underneath — the
 * Cloudscape "table with nested resources" shape. Parents come from GET /lots (server-side
 * paging, sorting and text match, parents kept when a child matches); children are fetched
 * from GET /lots/:ref only when a coffee is expanded and sorted client-side by date.
 */
export function LotsTable({ book, filters, initialExpandedRef, onSendClick }: LotsTableProps) {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>(() =>
    initialExpandedRef ? { [initialExpandedRef]: true } : {},
  );
  React.useEffect(() => {
    if (initialExpandedRef) setExpanded((prev) => (prev[initialExpandedRef] ? prev : { ...prev, [initialExpandedRef]: true }));
  }, [initialExpandedRef]);
  const [childSort, setChildSort] = React.useState<Record<string, SortDir>>({});

  const requestFilters = React.useMemo<FilterState>(() => {
    const q = text(filters.q) ?? text(filters.ref);
    const next: FilterState = { book };
    if (q) next.q = q;
    return next;
  }, [book, filters.q, filters.ref]);
  const searching = !!(text(filters.q) ?? text(filters.ref));

  const expandedRefs = React.useMemo(() => Object.keys(expanded).filter((ref) => expanded[ref]), [expanded]);
  const detailQueries = useLotSendsMany(expandedRefs);
  const sendsByRef = React.useMemo(() => {
    const map = new Map<string, (typeof detailQueries)[number]>();
    expandedRefs.forEach((ref, i) => map.set(ref, detailQueries[i]!));
    return map;
  }, [expandedRefs, detailQueries]);

  const getSubRows = React.useCallback(
    (row: RowData): RowData[] => {
      const ref = String(row.ref);
      if (!expanded[ref]) return [];
      const q = sendsByRef.get(ref);
      if (!q || q.isPending) return [{ __placeholder: 'loading', id: 'loading' }];
      if (q.isError || !q.data) return [{ __placeholder: 'error', id: 'error' }];
      const dir = childSort[ref] ?? 'desc';
      const sends = [...q.data.sends].sort((a, b) => (dir === 'desc' ? sendTime(b) - sendTime(a) : sendTime(a) - sendTime(b)));
      return [{ __placeholder: 'header', id: 'header' }, ...sends];
    },
    [expanded, sendsByRef, childSort],
  );

  const renderSubRow = React.useCallback(
    (sub: RowData, parent: RowData) => {
      if (isPlaceholder(sub)) {
        if (sub.__placeholder === 'loading') return <span className="block pl-7 text-xs text-muted-foreground">Loading sends…</span>;
        if (sub.__placeholder === 'error') return <span className="block pl-7 text-xs text-destructive">Couldn’t load the sends of this coffee.</span>;
        const ref = String(parent.ref);
        const dir = childSort[ref] ?? 'desc';
        const Arrow = dir === 'desc' ? IconArrowDown : IconArrowUp;
        return (
          <div className={cn(CHILD_GRID, 'uppercase tracking-wide text-muted-foreground')}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setChildSort((prev) => ({ ...prev, [ref]: dir === 'desc' ? 'asc' : 'desc' }));
              }}
              aria-label={`Date, sorted ${dir === 'desc' ? 'newest first' : 'oldest first'} — click to flip`}
              className="inline-flex w-fit items-center gap-1 rounded-[2px] uppercase hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Date <Arrow className="size-3" aria-hidden="true" />
            </button>
            <span>Receiver</span>
            <span>Qty</span>
            <span>Courier / AWB</span>
            <span>Status</span>
            <span>Order</span>
          </div>
        );
      }
      const send = sub as unknown as LotSend;
      const courier = [send.courier_norm, send.awb].filter((p) => !!p).join(' · ');
      return (
        <div className={CHILD_GRID}>
          <span className="tabular-nums">{send.date_on ? send.date_on.slice(0, 10) : '—'}</span>
          <span className="truncate text-foreground">{send.receiver || '—'}</span>
          <span className="tabular-nums">{formatQty(send.qty_grams) ?? '—'}</span>
          <span className="truncate">{courier || '—'}</span>
          <span><StatusBadge kind="status" value={send.status} /></span>
          <span className="truncate">{send.consignment_number || '—'}</span>
        </div>
      );
    },
    [childSort],
  );

  const onSubRowClick = React.useCallback(
    (sub: RowData) => {
      if (isPlaceholder(sub)) return;
      onSendClick(sub as unknown as LotSend);
    },
    [onSendClick],
  );

  const toggle = React.useCallback((row: RowData) => {
    const ref = String(row.ref);
    setExpanded((prev) => ({ ...prev, [ref]: !prev[ref] }));
  }, []);

  const columns = React.useMemo(() => columnsFor(book), [book]);

  return (
    <RecordTable
      endpoint={LOTS_ENDPOINT}
      columns={columns}
      filters={requestFilters}
      onRowClick={toggle}
      rowId={(row) => String(row.ref)}
      initialSort={{ sort: 'last_send_on', order: 'desc' }}
      expandable={{
        expanded,
        onExpandedChange: setExpanded,
        getSubRows,
        renderSubRow,
        onSubRowClick,
        expandLabel: (row) => `Toggle sends of ${String(row.ref)}`,
      }}
      countLabel={(n) => (searching ? `${n} match${n === 1 ? '' : 'es'}` : `${n} coffee${n === 1 ? '' : 's'}`)}
    />
  );
}
