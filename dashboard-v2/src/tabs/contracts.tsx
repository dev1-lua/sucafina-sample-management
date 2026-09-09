import { StatusBadge } from '@/components/StatusBadge';
import { CellValue } from '@/components/CellValue';
import { cn } from '@/lib/cn';
import { daysUntil } from '@/lib/format';
import type { PssCounts } from '@/components/contract-types';
import type { TabConfig } from './registry';

// Contracts + PSS (migration 020). Deliberately NOT in TAB_REGISTRY: `TabKey` gates the sample-tab
// machinery (drawer routes, column menus, create dialogs) and contracts are a section of their own —
// ContractsPage passes these pieces straight to RecordTable, the way ClientsPage does.

export const CONTRACT_STATUSES = [
  'open', 'pss_pending', 'pss_partial', 'pss_rejected', 'pss_approved', 'shipped', 'cancelled',
];

/**
 * A PSS due date read as a deadline, not a date: red once it is past (unless this row's own sample
 * is already approved — an approved PSS owes nothing), amber inside the last week, plain otherwise.
 * Shared by the Contracts list and the Commercial book, whose rows carry the contract's due date.
 */
export function PssDueCell({ row }: { row: Record<string, unknown> }) {
  const due = row.pss_due_date;
  if (due == null || due === '') return <CellValue value={null} />;
  const left = daysUntil(due);
  const settled = row.result_norm === 'approved';
  const overdue = left !== null && left < 0 && !settled;
  const soon = left !== null && left >= 0 && left <= 7 && !settled;
  return (
    <span className={cn('tabular-nums', overdue && 'font-medium text-rose-600 dark:text-rose-400', soon && 'font-medium text-amber-600 dark:text-amber-400')}>
      {String(due).slice(0, 10)}
      {overdue && ` · overdue ${-left!}d`}
      {soon && (left === 0 ? ' · today' : ` · ${left}d`)}
    </span>
  );
}

/** "1 of 2" approved — the one number that says how far a contract's PSS have got. */
function PssProgressCell({ row }: { row: Record<string, unknown> }) {
  const counts = row.pss_counts as PssCounts | undefined;
  if (!counts) return <CellValue value={null} />;
  return (
    <span className="tabular-nums">
      {counts.approved} of {counts.expected}
      {counts.rejected > 0 && <span className="text-rose-600 dark:text-rose-400"> · {counts.rejected} rejected</span>}
    </span>
  );
}

export const contractsConfig: TabConfig = {
  endpoint: '/contracts',
  path: '/contracts',
  entityLabel: 'Contract',
  // The API already sorts by pss_due_date ASC — what is owed soonest first.
  columns: [
    { key: 'contract_number', header: 'Contract #', sortKey: 'contract_number' },
    { key: 'client_name', header: 'Client', sortKey: 'client_name' },
    { key: 'quality', header: 'Quality' },
    { key: 'destination', header: 'Destination' },
    { key: 'shipment_date', header: 'Shipment', sortKey: 'shipment_date' },
    { key: 'pss_due_date', header: 'PSS due', sortKey: 'pss_due_date', render: (r) => <PssDueCell row={r} /> },
    { key: 'containers', header: 'Containers', sortKey: 'containers', width: 110 },
    { key: 'pss_counts', header: 'PSS approved', width: 150, render: (r) => <PssProgressCell row={r} /> },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      pinned: 'right',
      render: (r) => <StatusBadge kind="contract_status" value={r.status as string | null} />,
    },
  ],
  filters: [
    { key: 'status', label: 'Status', type: 'enum', options: CONTRACT_STATUSES, multi: true },
    { key: 'overdue', label: 'PSS overdue', type: 'bool' },
  ],
  // Contracts drill down to a full show-page, not a drawer — nothing reads these.
  detailFields: [],
};
