import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { IconPlus } from '@tabler/icons-react';

import { RecordTable } from '@/components/RecordTable';
import { ColumnMenu, useColumnVisibility } from '@/components/ColumnMenu';
import { CreateRecordDialog } from '@/components/CreateRecordDialog';
import { Button } from '@/components/ui/button';
import { TAB_REGISTRY } from '@/tabs/registry';
import { useRowHighlight } from '@/lib/highlight';

const cfg = TAB_REGISTRY.bulk;

export default function BulkPage() {
  const navigate = useNavigate();
  const [visibility, setVisibility] = useColumnVisibility(`sucafina-cols-${cfg.endpoint}`, cfg.columns);
  const [createOpen, setCreateOpen] = useState(false);
  const highlightId = useRowHighlight(cfg.path);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-end gap-2">
        <ColumnMenu columns={cfg.columns} value={visibility} onChange={setVisibility} />
        {cfg.createFields && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <IconPlus className="size-3.5" /> New
          </Button>
        )}
      </div>
      <RecordTable
        endpoint={cfg.endpoint}
        columns={cfg.columns}
        filters={{}}
        onRowClick={(row) => navigate(`${cfg.path}/${String(row.id)}`)}
        columnVisibility={visibility}
        highlightId={highlightId}
        sortable={false}
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
    </div>
  );
}
