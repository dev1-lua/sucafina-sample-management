import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconPlus } from '@tabler/icons-react';

import { FilterBar } from '@/components/FilterBar';
import { RecordTable } from '@/components/RecordTable';
import { Button } from '@/components/ui/button';
import { ContractFormDialog } from '@/components/ContractFormDialog';
import { contractsConfig } from '@/tabs/contracts';
import type { FilterState } from '@/types';

export default function ContractsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterState>({});
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterBar defs={contractsConfig.filters} value={filters} onChange={setFilters} />
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <IconPlus className="size-3.5" /> New contract
        </Button>
      </div>
      <RecordTable
        endpoint={contractsConfig.endpoint}
        columns={contractsConfig.columns}
        filters={filters}
        // Contracts drill down to a full show-page (containers + their PSS), not a drawer — the
        // sibling `/contracts/:id` route in App.tsx replaces this list entirely.
        onRowClick={(row) => navigate(`${contractsConfig.path}/${String(row.id)}`)}
      />
      <ContractFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(row) => navigate(`${contractsConfig.path}/${String(row.id)}`)}
      />
    </div>
  );
}
