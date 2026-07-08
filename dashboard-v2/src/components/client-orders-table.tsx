import * as React from 'react';
import { useNavigate } from 'react-router-dom';

import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/StatusBadge';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ClientOrder, ClientOrderTab } from './client-types';

const TAB_LABEL: Record<ClientOrderTab, string> = {
  specialty: 'Specialty',
  bulk: 'Bulk',
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

/** Cross-table (specialty/bulk/forwarding) order history for a client, client-side sortable
 * by order date. The server already returns rows date-sorted desc, so the initial render
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
    return <p className="py-6 text-center text-sm text-muted-foreground">No orders placed by this client yet.</p>;
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
