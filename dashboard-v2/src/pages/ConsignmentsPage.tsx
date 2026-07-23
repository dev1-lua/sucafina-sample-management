import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconPlus } from '@tabler/icons-react';

import { FilterBar } from '@/components/FilterBar';
import { RecordTable } from '@/components/RecordTable';
import { CellValue } from '@/components/CellValue';
import { Button } from '@/components/ui/button';
import { useCreateRecord } from '@/lib/query';
import { formatLocation } from '@/lib/format';
import type { ColumnDef, FilterDef, FilterState } from '@/types';

// Consignment number/location/status aren't server-sortable (the /consignments list is fixed
// newest-first), so these columns carry no sortKey.
const columns: ColumnDef[] = [
  { key: 'number', header: 'Consignment #' },
  { key: 'location', header: 'Location', render: (r) => <CellValue value={formatLocation(r.location)} /> },
  { key: 'status', header: 'Status', render: (r) => <CellValue value={r.status} humanize /> },
  { key: 'member_count', header: 'Samples' },
  { key: 'notes', header: 'Notes' },
  { key: 'created_at', header: 'Created', render: (r) => <CellValue value={r.created_at ? String(r.created_at).slice(0, 10) : null} /> },
];

const filters: FilterDef[] = [
  { key: 'location', label: 'Location', type: 'enum', options: ['westlands', 'thika'] },
  { key: 'status', label: 'Status', type: 'enum', options: ['open', 'dispatched', 'closed'] },
];

export default function ConsignmentsPage() {
  const navigate = useNavigate();
  const [filterState, setFilterState] = useState<FilterState>({});
  const create = useCreateRecord('/consignments');

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterBar defs={filters} value={filterState} onChange={setFilterState} />
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
        filters={filterState}
        onRowClick={(row) => navigate(`/consignments/${String(row.id)}`)}
      />
    </div>
  );
}
