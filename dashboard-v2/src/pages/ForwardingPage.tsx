import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';

import { FilterBar } from '@/components/FilterBar';
import { RecordTable } from '@/components/RecordTable';
import { TAB_REGISTRY } from '@/tabs/registry';
import type { FilterState } from '@/types';

const cfg = TAB_REGISTRY.forwarding;

export default function ForwardingPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterState>({});

  return (
    <div className="flex flex-col gap-3 p-4">
      <FilterBar defs={cfg.filters} value={filters} onChange={setFilters} />
      <RecordTable
        endpoint={cfg.endpoint}
        columns={cfg.columns}
        filters={filters}
        onRowClick={(row) => navigate(`${cfg.path}/${String(row.id)}`)}
      />
      <Outlet />
    </div>
  );
}
