import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { IconPlus } from '@tabler/icons-react';

import { FilterBar } from '@/components/FilterBar';
import { RecordTable } from '@/components/RecordTable';
import { ColumnMenu, useColumnVisibility } from '@/components/ColumnMenu';
import { CreateRecordDialog } from '@/components/CreateRecordDialog';
import { Button } from '@/components/ui/button';
import { TAB_REGISTRY } from '@/tabs/registry';
import { useRowHighlight } from '@/lib/highlight';
import type { FilterState, TabKey } from '@/types';

/** The list body shared by all three Sample Management tabs (specialty / bulk /
 * forwarding). Formerly three byte-identical page files that differed only in which
 * TAB_REGISTRY config they loaded — now one component parameterized by `tab`. The
 * top tab strip is rendered once by SampleManagementLayout; this renders the
 * table + its own <Outlet/> for the row-drawer child route (`/:id`). */
export default function SampleListView({ tab }: { tab: TabKey }) {
  const cfg = TAB_REGISTRY[tab];
  const navigate = useNavigate();
  const [filters, setFilters] = useState<FilterState>({});
  const [visibility, setVisibility] = useColumnVisibility(`sucafina-cols-${cfg.endpoint}`, cfg.columns);
  const [createOpen, setCreateOpen] = useState(false);
  const highlightId = useRowHighlight(cfg.path);

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        <ColumnMenu columns={cfg.columns} value={visibility} onChange={setVisibility} />
        {cfg.createFields && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <IconPlus className="size-3.5" /> New
          </Button>
        )}
      </div>
      <FilterBar defs={cfg.filters} value={filters} onChange={setFilters} />
      <RecordTable
        endpoint={cfg.endpoint}
        columns={cfg.columns}
        filters={filters}
        onRowClick={(row) => navigate(`${cfg.path}/${String(row.id)}`)}
        columnVisibility={visibility}
        highlightId={highlightId}
      />
      {cfg.createFields && (
        <CreateRecordDialog
          endpoint={cfg.endpoint}
          entityLabel={cfg.entityLabel}
          fields={cfg.createFields}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      )}
      <Outlet />
    </>
  );
}
