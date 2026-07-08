import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconPlus } from '@tabler/icons-react';

import { RecordTable } from '@/components/RecordTable';
import { Button } from '@/components/ui/button';
import { ClientFormDialog } from '@/components/ClientFormDialog';
import { TAB_REGISTRY } from '@/tabs/registry';

const cfg = TAB_REGISTRY.clients;

export default function ClientsPage() {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <IconPlus className="size-3.5" /> New client
        </Button>
      </div>
      <RecordTable
        endpoint={cfg.endpoint}
        columns={cfg.columns}
        filters={{}}
        // Clients drill-down is a full show-page (not a drawer) — navigate() here lands on
        // the sibling `/clients/:id` route (see App.tsx), replacing this list entirely.
        onRowClick={(row) => navigate(`${cfg.path}/${String(row.id)}`)}
        sortable={false}
      />
      <ClientFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(row) => navigate(`${cfg.path}/${String(row.id)}`)}
      />
    </div>
  );
}
