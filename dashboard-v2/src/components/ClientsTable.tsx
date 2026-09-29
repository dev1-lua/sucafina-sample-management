import * as React from 'react';
import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';

import { RecordTable } from '@/components/RecordTable';
import { CellValue } from '@/components/CellValue';
import { StatusBadge } from '@/components/StatusBadge';
import { SendId, SEND_ID_TITLE } from '@/components/SendId';
import { CLIENT_SENDS_ENDPOINT, useClientSendsMany, type ClientSend, type LotBook } from '@/lib/query';
import { formatQty } from '@/lib/format';
import { normalizeRef, optionLetterOf } from '@/lib/lots';
import { cn } from '@/lib/cn';
import type { ColumnDef, FilterState } from '@/types';

type RowData = Record<string, unknown>;
type SortDir = 'asc' | 'desc';

/** The rows nested under an expanded client besides its sends: a state line or the child header. */
type Placeholder = { __placeholder: 'loading' | 'error' | 'header'; id: string };
const isPlaceholder = (row: RowData): row is Placeholder & RowData => typeof row.__placeholder === 'string';

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

// Parent columns: Client · Coffees · Sends · Open · Awaiting result · Approved · Rejected · Last send · Status.
// Sort keys are the API's whitelist for /client-sends (client_name, sends, coffees, last_send_on, open_sends).
const COLUMNS: ColumnDef[] = [
  { key: 'client_name', header: 'Client', sortKey: 'client_name', width: 220 },
  { key: 'coffees', header: 'Coffees', sortKey: 'coffees', width: 80, headerTitle: 'Distinct references sent to this client (a reference names one coffee).' },
  { key: 'sends', header: 'Sends', sortKey: 'sends', width: 70, headerTitle: 'Every sample sent or still to go, each with its own Send ID.' },
  { key: 'open_sends', header: 'Open', sortKey: 'open_sends', width: 70, headerTitle: 'Requested or being prepared — not dispatched yet.' },
  { key: 'awaiting_results', header: 'Awaiting result', width: 120, headerTitle: 'Delivered, no result logged yet.' },
  { key: 'approved', header: 'Approved', width: 90 },
  { key: 'rejected', header: 'Rejected', width: 90 },
  { key: 'last_send_on', header: 'Last send', sortKey: 'last_send_on', width: 110, render: (r) => <CellValue value={text(r.last_send_on)?.slice(0, 10)} /> },
  { key: 'status_rollup', header: 'Status', width: 200 },
];

// Child rows share one grid so the columns line up under every expanded client:
// Send ID · Date · Ref (+option) · Coffee · Qty · Courier/AWB · Status · Result · Order.
const CHILD_GRID = 'grid h-8 grid-cols-[80px_92px_130px_minmax(0,1fr)_64px_150px_100px_96px_90px] items-center gap-3 pl-7 pr-2 text-xs';

function sendTime(s: ClientSend): number {
  const t = s.date_on ? Date.parse(s.date_on) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

/** "SSKE-104929B" already carries its option; a legacy row with the letter only in `option_letter` gets "· B". */
function refLabel(send: ClientSend): string {
  const ref = text(send.ref);
  if (!ref) return '—';
  const letter = optionLetterOf(send);
  return letter && !normalizeRef(ref).endsWith(letter) ? `${ref} · ${letter}` : ref;
}

export type ClientsTableProps = {
  book: LotBook;
  // The list page's FilterState. `q` goes to the server as `q` (fuzzy: the client's name, refs
  // and send ids); `client` goes as `client=` — an EXACT, case-insensitive name match, so the
  // deep link from a Sends row's client cell opens that client and not a longer name that
  // happens to contain it ("Torch" must not open "Torch Roasters"). When `client` is set, the
  // matched row opens straight away.
  filters: FilterState;
  onSendClick: (send: ClientSend) => void;
};

/**
 * Clients view (round 11): one row per client with every send to them nested underneath —
 * the same nested-resources shape as the Coffees view (LotsTable). Parents come from
 * GET /client-sends?book= (server-side paging, sorting and text match; keepPreviousData via
 * RecordTable stays); children are fetched from GET /client-sends/:key?book= only when a client
 * is expanded and sorted client-side by date.
 */
export function ClientsTable({ book, filters, onSendClick }: ClientsTableProps) {
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [childSort, setChildSort] = React.useState<Record<string, SortDir>>({});

  const q = text(filters.q);
  const client = text(filters.client);
  const requestFilters = React.useMemo<FilterState>(() => {
    const next: FilterState = { book };
    if (q) next.q = q;
    if (client) next.client = client;
    return next;
  }, [book, q, client]);

  // The exact `client=` filter (a `?client=` deep link or the Client chip): the group key
  // (`id:<uuid>` / `name:<lower>`) is the server's to mint, so the row it returns is the one
  // to open — once per name. Free text alone never opens anything.
  const autoExpandedFor = React.useRef<string | null>(null);
  const onRowsLoaded = React.useCallback(
    (rows: RowData[]) => {
      if (!client || autoExpandedFor.current === client) return;
      const first = rows[0];
      if (!first) return;
      autoExpandedFor.current = client;
      const key = String(first.key);
      setExpanded((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
    },
    [client],
  );

  const expandedKeys = React.useMemo(() => Object.keys(expanded).filter((key) => expanded[key]), [expanded]);
  const detailQueries = useClientSendsMany(expandedKeys, book);
  const sendsByKey = React.useMemo(() => {
    const map = new Map<string, (typeof detailQueries)[number]>();
    expandedKeys.forEach((key, i) => map.set(key, detailQueries[i]!));
    return map;
  }, [expandedKeys, detailQueries]);

  const getSubRows = React.useCallback(
    (row: RowData): RowData[] => {
      const key = String(row.key);
      if (!expanded[key]) return [];
      const q = sendsByKey.get(key);
      if (!q || q.isPending) return [{ __placeholder: 'loading', id: 'loading' }];
      if (q.isError || !q.data) return [{ __placeholder: 'error', id: 'error' }];
      const dir = childSort[key] ?? 'desc';
      const sends = [...q.data.sends].sort((a, b) => (dir === 'desc' ? sendTime(b) - sendTime(a) : sendTime(a) - sendTime(b)));
      return [{ __placeholder: 'header', id: 'header' }, ...sends];
    },
    [expanded, sendsByKey, childSort],
  );

  const renderSubRow = React.useCallback(
    (sub: RowData, parent: RowData) => {
      if (isPlaceholder(sub)) {
        if (sub.__placeholder === 'loading') return <span className="block pl-7 text-xs text-muted-foreground">Loading sends…</span>;
        if (sub.__placeholder === 'error') return <span className="block pl-7 text-xs text-destructive">Couldn’t load the sends to this client.</span>;
        const key = String(parent.key);
        const dir = childSort[key] ?? 'desc';
        const Arrow = dir === 'desc' ? IconArrowDown : IconArrowUp;
        return (
          <div className={cn(CHILD_GRID, 'uppercase tracking-wide text-muted-foreground')}>
            <span title={SEND_ID_TITLE}>Send ID</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setChildSort((prev) => ({ ...prev, [key]: dir === 'desc' ? 'asc' : 'desc' }));
              }}
              aria-label={`Date, sorted ${dir === 'desc' ? 'newest first' : 'oldest first'} — click to flip`}
              className="inline-flex w-fit items-center gap-1 rounded-[2px] uppercase hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Date <Arrow className="size-3" aria-hidden="true" />
            </button>
            <span>Ref</span>
            <span>Coffee</span>
            <span>Qty</span>
            <span>Courier / AWB</span>
            <span>Status</span>
            <span>Result</span>
            <span>Order</span>
          </div>
        );
      }
      const send = sub as unknown as ClientSend;
      const courier = [send.courier_norm, send.awb].filter((p) => !!p).join(' · ');
      return (
        <div className={CHILD_GRID}>
          <SendId value={send.send_id} />
          <span className="tabular-nums">{send.date_on ? send.date_on.slice(0, 10) : '—'}</span>
          <span className="truncate font-medium text-foreground">{refLabel(send)}</span>
          <span className="truncate text-foreground">{send.title || '—'}</span>
          <span className="tabular-nums">{formatQty(send.qty_grams) ?? '—'}</span>
          <span className="truncate">{courier || '—'}</span>
          <span><StatusBadge kind="status" value={send.status} /></span>
          <span><StatusBadge kind="result" value={send.result_norm} /></span>
          <span className="truncate">{send.consignment_number || '—'}</span>
        </div>
      );
    },
    [childSort],
  );

  const onSubRowClick = React.useCallback(
    (sub: RowData) => {
      if (isPlaceholder(sub)) return;
      onSendClick(sub as unknown as ClientSend);
    },
    [onSendClick],
  );

  const toggle = React.useCallback((row: RowData) => {
    const key = String(row.key);
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <RecordTable
      endpoint={CLIENT_SENDS_ENDPOINT}
      columns={COLUMNS}
      filters={requestFilters}
      onRowClick={toggle}
      rowId={(row) => String(row.key)}
      initialSort={{ sort: 'last_send_on', order: 'desc' }}
      expandable={{
        expanded,
        onExpandedChange: setExpanded,
        getSubRows,
        renderSubRow,
        onSubRowClick,
        expandLabel: (row) => `Toggle sends to ${String(row.client_name)}`,
      }}
      countLabel={(n) => `${n} client${n === 1 ? '' : 's'}`}
      onRowsLoaded={onRowsLoaded}
    />
  );
}
