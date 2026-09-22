import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { cn } from '@/lib/cn';
import { useRecords } from '@/lib/query';
import { StatusBadge } from '@/components/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ClientOrder, ClientOrderTab } from './client-types';

const HEAD = 'text-xs uppercase tracking-wide text-muted-foreground';

/** Round 10: the client's ORDERS (consignments — one request of several coffees) from
 * GET /consignments?client_id=, shown above the per-sample history below. Newest first as
 * the API returns them; each number opens the order page. */
export function ClientConsignmentsTable({ clientId }: { clientId: string }) {
  const query = useRecords('/consignments', { sort: null, filters: { client_id: clientId }, page: 1, pageSize: 50 });
  const rows = query.data?.data ?? [];

  if (query.isLoading) return <Skeleton className="h-16 w-full" />;
  if (query.isError) return <p className="py-6 text-center text-sm text-muted-foreground">Couldn’t load this client’s orders.</p>;
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No orders for this client yet.</p>;

  return (
    <div className="max-h-[20rem] overflow-auto rounded-[4px] border border-border">
      <table className="w-full caption-bottom text-sm">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow className="hover:bg-transparent">
            <TableHead className={HEAD}>Order</TableHead>
            <TableHead className={HEAD}>Date</TableHead>
            <TableHead className={HEAD}>Samples</TableHead>
            <TableHead className={HEAD}>Status</TableHead>
            <TableHead className={HEAD}>Requested by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((o) => (
            <TableRow key={String(o.id)}>
              <TableCell className="font-medium">
                <Link to={`/consignments/${String(o.id)}`} className="rounded-[2px] text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {String(o.number ?? '')}
                </Link>
              </TableCell>
              <TableCell className="tabular-nums">{typeof o.created_at === 'string' ? o.created_at.slice(0, 10) : '—'}</TableCell>
              <TableCell className="tabular-nums">{typeof o.member_count === 'number' ? o.member_count : '—'}</TableCell>
              <TableCell>
                <StatusBadge kind="order_status" value={typeof o.derived_status === 'string' ? o.derived_status : null} />
              </TableCell>
              <TableCell>{displayValue(typeof o.requested_by === 'string' ? o.requested_by : null)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  );
}

const TAB_LABEL: Record<ClientOrderTab, string> = {
  specialty: 'Specialty',
  bulk: 'Commercial',
  forwarding: 'Forwarding',
};

// Tab -> frontend route map (per design spec): specialty=/samples, bulk=/bulk, forwarding=/forwarding.
const TAB_PATH: Record<ClientOrderTab, string> = {
  specialty: '/samples',
  bulk: '/bulk',
  forwarding: '/forwarding',
};

// Small identity pills distinct from the status/result badge palette (lib/tags.ts) so the
// "which table is this row from" signal never gets confused with a status/result value.
const TAB_PILL_CLASS: Record<ClientOrderTab, string> = {
  specialty: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  bulk: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  forwarding: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
};

function formatDate(value: string | null): React.ReactNode {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function displayValue(value: string | null): React.ReactNode {
  if (value === null || value === '') return <span className="text-muted-foreground">—</span>;
  return value;
}

type SortDir = 'asc' | 'desc';

/** Cross-table (specialty/bulk/forwarding) SAMPLE history for a client (one row per send;
 * the "Samples" card on the client page — orders/consignments live in ClientConsignmentsTable
 * above it), client-side sortable by order date. The server already returns rows date-sorted desc, so the initial render
 * needs no re-sort — clicking the header just flips direction. */
export function ClientOrdersTable({ orders }: { orders: ClientOrder[] }) {
  const navigate = useNavigate();
  const [sortDir, setSortDir] = React.useState<SortDir>('desc');

  const sorted = React.useMemo(() => {
    const copy = [...orders];
    copy.sort((a, b) => {
      const at = a.date_on ? new Date(a.date_on).getTime() : -Infinity;
      const bt = b.date_on ? new Date(b.date_on).getTime() : -Infinity;
      return sortDir === 'asc' ? at - bt : bt - at;
    });
    return copy;
  }, [orders, sortDir]);

  if (orders.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No samples sent to this client yet.</p>;
  }

  function toggleSort() {
    setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
  }

  return (
    <div className="max-h-[28rem] overflow-auto rounded-[4px] border border-border">
      <table className="w-full caption-bottom text-sm">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">Tab</TableHead>
            <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">Ref</TableHead>
            <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">Status</TableHead>
            <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">Courier</TableHead>
            <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">AWB</TableHead>
            <TableHead
              className="cursor-pointer select-none text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground"
              onClick={toggleSort}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleSort();
                }
              }}
              aria-sort={sortDir === 'asc' ? 'ascending' : 'descending'}
            >
              <span className="inline-flex items-center gap-1">
                Order Date
                <span aria-hidden="true">{sortDir === 'asc' ? '↑' : '↓'}</span>
              </span>
            </TableHead>
            <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">Delivery</TableHead>
            <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((order) => (
            <TableRow
              key={`${order.tab}-${order.id}`}
              className="cursor-pointer"
              onClick={() => navigate(`${TAB_PATH[order.tab]}/${order.id}`)}
            >
              <TableCell>
                <span
                  className={cn(
                    'inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-xs font-medium',
                    TAB_PILL_CLASS[order.tab],
                  )}
                >
                  {TAB_LABEL[order.tab]}
                </span>
              </TableCell>
              <TableCell className="font-medium">{displayValue(order.ref)}</TableCell>
              <TableCell>
                <StatusBadge kind="status" value={order.status} />
              </TableCell>
              <TableCell>{displayValue(order.courier_norm)}</TableCell>
              <TableCell>{displayValue(order.awb)}</TableCell>
              <TableCell>{formatDate(order.date_on)}</TableCell>
              <TableCell>{formatDate(order.delivery_on)}</TableCell>
              <TableCell>
                <StatusBadge kind="result" value={order.result_norm} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  );
}
