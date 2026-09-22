import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconPlus } from '@tabler/icons-react';

import { FilterBar } from '@/components/FilterBar';
import { RecordTable } from '@/components/RecordTable';
import { CellValue } from '@/components/CellValue';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { useClients, useCreateRecord, type LotBook } from '@/lib/query';
import { formatLocation } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { ColumnDef, FilterDef, FilterState } from '@/types';

// Consignment number/client/status aren't server-sortable (the /consignments list is fixed
// newest-first), so these columns carry no sortKey.
// Round 10: an order is a consignment — one request of several coffees to one client — so the
// list leads with who asked and where the order stands (derived from its members).
const columns: ColumnDef[] = [
  { key: 'number', header: 'Order', width: 110 },
  { key: 'client_name', header: 'Client', width: 200 },
  { key: 'requested_by', header: 'Requested by', width: 130 },
  { key: 'member_count', header: 'Samples', width: 90 },
  { key: 'derived_status', header: 'Status', width: 150, render: (r) => <StatusBadge kind="order_status" value={typeof r.derived_status === 'string' ? r.derived_status : null} /> },
  { key: 'location', header: 'Location', width: 110, render: (r) => <CellValue value={formatLocation(r.location)} /> },
  { key: 'created_at', header: 'Date', width: 110, render: (r) => <CellValue value={r.created_at ? String(r.created_at).slice(0, 10) : null} /> },
];

const BOOK_FILTER: FilterDef = { key: 'book', label: 'Book', type: 'enum', options: ['specialty', 'commercial'] };
const STATIC_FILTERS: FilterDef[] = [
  { key: 'location', label: 'Location', type: 'enum', options: ['westlands', 'thika'] },
  { key: 'status', label: 'Status', type: 'enum', options: ['open', 'dispatched', 'closed'] },
];

export type ConsignmentsPageProps = {
  // Preset by a book page's Orders view: sent on every request, not offered as a chip.
  book?: LotBook;
  // Rendered inside a book page (no outer padding — the page already provides it).
  embedded?: boolean;
};

export default function ConsignmentsPage({ book, embedded = false }: ConsignmentsPageProps) {
  const navigate = useNavigate();
  const [filterState, setFilterState] = useState<FilterState>({});
  const create = useCreateRecord('/consignments');

  // The Client chip lists client names; the API filters by id (contracts §6), so the
  // chosen name is translated on the way out.
  const clients = useClients({ sort: { sort: 'name', order: 'asc' }, filters: {}, page: 1, pageSize: 200 });
  const clientRows = useMemo(
    () => (clients.data?.data ?? []).filter((c): c is { id: string; name: string } => typeof c.id === 'string' && typeof c.name === 'string'),
    [clients.data],
  );
  const filterDefs = useMemo<FilterDef[]>(
    () => [
      ...(book ? [] : [BOOK_FILTER]),
      { key: 'client', label: 'Client', type: 'enum', options: clientRows.map((c) => c.name), searchable: true },
      ...STATIC_FILTERS,
    ],
    [book, clientRows],
  );
  const requestFilters = useMemo<FilterState>(() => {
    const { client, ...rest } = filterState;
    const next: FilterState = { ...rest };
    if (book) next.book = book;
    const clientId = typeof client === 'string' ? clientRows.find((c) => c.name === client)?.id : undefined;
    if (clientId) next.client_id = clientId;
    return next;
  }, [filterState, book, clientRows]);

  return (
    <div className={cn('flex flex-col gap-3', !embedded && 'p-4')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterBar defs={filterDefs} value={filterState} onChange={setFilterState} />
        <Button
          size="sm"
          disabled={create.isPending}
          onClick={() => create.mutate({}, { onSuccess: (row) => navigate(`/consignments/${String(row.id)}`) })}
        >
          <IconPlus className="size-3.5" /> New consignment
        </Button>
      </div>
      <RecordTable
        endpoint="/consignments"
        columns={columns}
        filters={requestFilters}
        onRowClick={(row) => navigate(`/consignments/${String(row.id)}`)}
        countLabel={(n) => `${n} order${n === 1 ? '' : 's'}`}
      />
    </div>
  );
}
