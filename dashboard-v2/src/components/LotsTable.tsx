import * as React from 'react';
import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';

import { RecordTable } from '@/components/RecordTable';
import { CellValue } from '@/components/CellValue';
import { StatusBadge } from '@/components/StatusBadge';
import { LOTS_ENDPOINT, useLotSendsMany, type LotBook, type LotSend } from '@/lib/query';
import { formatQty } from '@/lib/format';
import { isPssGroup, lotRefFor, optionLetterOf } from '@/lib/lots';
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

function optionLetters(lot: RowData): string[] {
  return Array.isArray(lot.options) ? lot.options.filter((o): o is string => typeof o === 'string' && o !== '') : [];
}

/** A PSS lot (`SSKE-<contract digits>`) groups the lettered options drawn against one contract. */
export function isPssLot(lot: RowData): boolean {
  return isPssGroup(text(lot.ref)) || optionLetters(lot).length > 0;
}

/** "CK Corporation · options A, B" — the contract's client (else the last receiver) and the live options. */
export function pssGroupLabel(lot: RowData): string | null {
  const who = text(lot.contract_client) ?? text(lot.last_receiver);
  const options = optionLetters(lot);
  const parts = [who, options.length ? `options ${options.join(', ')}` : null].filter((p): p is string => p !== null);
  return parts.length ? parts.join(' · ') : null;
}

function columnsFor(book: LotBook): ColumnDef[] {
  return [
    { key: 'ref', header: 'Ref', sortKey: 'ref', width: 120 },
    {
      key: 'coffee',
      header: 'Coffee',
      sortKey: book === 'specialty' ? 'outturn' : 'quality',
      width: 260,
      render: (r) => <CellValue value={isPssLot(r) ? pssGroupLabel(r) : lotCoffeeLabel(r, book)} />,
    },
    { key: 'sends', header: 'Sends', sortKey: 'sends', width: 80 },
    { key: 'status_rollup', header: 'Status', width: 200 },
    { key: 'last_send_on', header: 'Last send', sortKey: 'last_send_on', width: 110, render: (r) => <CellValue value={text(r.last_send_on)?.slice(0, 10)} /> },
    { key: 'last_receiver', header: 'Last receiver', sortKey: 'last_receiver', width: 180 },
  ];
}

// Child rows share one grid so the columns line up under every expanded coffee; a PSS group
// leads with the option letter.
const CHILD_GRID = 'grid h-8 items-center gap-3 pl-7 pr-2 text-xs';
const SEND_COLS = 'grid-cols-[100px_minmax(0,1fr)_72px_160px_130px_100px]';
const PSS_SEND_COLS = 'grid-cols-[56px_100px_minmax(0,1fr)_72px_160px_130px_100px]';
const childGrid = (pss: boolean) => cn(CHILD_GRID, pss ? PSS_SEND_COLS : SEND_COLS);

function sendTime(s: LotSend): number {
  const t = s.date_on ? Date.parse(s.date_on) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

export type LotsTableProps = {
  book: LotBook;
  // The list page's FilterState. Only free text applies to lots: `q` (or the `ref` deep-link
  // filter) goes to the server as `q`, which also matches any send's receiver.
  filters: FilterState;
  // `?ref=` on load: open this coffee straight away. A lettered PSS ref (SSKE-104929A) opens
  // its contract group (SSKE-104929).
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
  // Rows are keyed by the lot ref, so a deep-linked option letter maps to its group first.
  const initialLotRef = initialExpandedRef ? lotRefFor(initialExpandedRef) : null;
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>(() =>
    initialLotRef ? { [initialLotRef]: true } : {},
  );
  React.useEffect(() => {
    if (initialLotRef) setExpanded((prev) => (prev[initialLotRef] ? prev : { ...prev, [initialLotRef]: true }));
  }, [initialLotRef]);
  const [childSort, setChildSort] = React.useState<Record<string, SortDir>>({});

  const requestFilters = React.useMemo<FilterState>(() => {
    // Free text is sent as typed; a `?ref=` deep link searches for the lot (the PSS base).
    const ref = text(filters.ref);
    const q = text(filters.q) ?? (ref ? lotRefFor(ref) : null);
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
          <div className={cn(childGrid(isPssLot(parent)), 'uppercase tracking-wide text-muted-foreground')}>
            {isPssLot(parent) && <span>Option</span>}
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
        <div className={childGrid(isPssLot(parent))}>
          {isPssLot(parent) && <span className="font-medium text-foreground">{optionLetterOf(send) ?? '—'}</span>}
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
