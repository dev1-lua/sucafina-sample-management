import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { IconArrowLeft, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';

import { useContract, useDeleteRecord, useDrawPss } from '@/lib/query';
import { cn } from '@/lib/cn';
import { daysUntil } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Timeline } from '@/components/Timeline';
import { StatusBadge } from '@/components/StatusBadge';
import { HighlightBanner } from '@/components/HighlightBanner';
import { useRecordHighlight } from '@/lib/highlight';
import { ContractFormDialog } from '@/components/ContractFormDialog';
import type { ContractContainer, ContractDetail, ContractPss } from '@/components/contract-types';

/** Dashboard route for one PSS row — Specialty lives at /samples, Commercial at /bulk. */
const sampleHref = (s: ContractPss) => `${s.tab === 'specialty' ? '/samples' : '/bulk'}/${s.id}`;

// An option slot's own state (api/src/lib/contracts.ts) is a smaller vocabulary than a contract's, so it
// gets its own chip rather than a tags.ts kind: the same palette family, read as a stage not a status.
const CONTAINER_STATE: Record<string, { label: string; className: string }> = {
  none: { label: 'no PSS yet', className: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300' },
  pending: { label: 'PSS pending', className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
  approved: { label: 'approved', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
  replacement_pending: { label: 'replacement pending', className: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
  failed: { label: 'replacement rejected', className: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300' },
};

/** "Option A" / "Option A → C" — the letters the slot has carried, oldest first. */
function slotTitle(c: ContractContainer): string {
  const letters = c.samples.map((s) => s.option_letter).filter((l): l is string => !!l);
  if (letters.length === 0) return `Option slot ${c.container_no}`;
  return `Option ${letters.join(' → ')}`;
}

function ContainerStateChip({ state }: { state: string }) {
  const s = CONTAINER_STATE[state] ?? { label: state.replace(/_/g, ' '), className: CONTAINER_STATE.none.className };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none', s.className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden="true" />
      {s.label}
    </span>
  );
}

function DueLine({ due }: { due: string | null }) {
  if (!due) return <span className="text-muted-foreground">no shipment date, so no PSS deadline</span>;
  const left = daysUntil(due);
  const label = left === null ? '' : left < 0 ? ` (overdue ${-left}d)` : left === 0 ? ' (today)' : ` (in ${left}d)`;
  return (
    <span className={left !== null && left < 0 ? 'text-rose-600 dark:text-rose-400' : undefined}>
      PSS due {due.slice(0, 10)}
      {label}
    </span>
  );
}

function PssRow({ sample }: { sample: ContractPss }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[4px] border border-border px-2 py-1.5 text-xs">
      <Link to={sampleHref(sample)} className="font-medium text-primary hover:underline">
        {sample.ref ?? '(no ref)'}
      </Link>
      {sample.option_letter && (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">option {sample.option_letter}</span>
      )}
      {sample.replaces_sample_id && (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">replacement</span>
      )}
      <StatusBadge kind="status" value={sample.status} />
      {sample.result_norm && <StatusBadge kind="result" value={sample.result_norm} />}
      {sample.stage && <span className="text-muted-foreground">{sample.stage}</span>}
      {sample.dispatched_on && <span className="text-muted-foreground">sent {String(sample.dispatched_on).slice(0, 10)}</span>}
      {sample.result_on && <span className="text-muted-foreground">answered {String(sample.result_on).slice(0, 10)}</span>}
    </div>
  );
}

function ContainerCard({ container, onDraw, drawing }: {
  container: ContractContainer;
  onDraw: (containerNo: number) => void;
  drawing: boolean;
}) {
  // A slot may be drawn by hand when nothing has been raised for it yet, or when every option in it was
  // rejected and the automatic replacement is gone (the API refuses any other case).
  const canDraw =
    container.state === 'none' ||
    (container.state === 'replacement_pending' && container.samples.every((s) => s.result_norm === 'rejected'));
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">{slotTitle(container)}</h3>
        <ContainerStateChip state={container.state} />
      </div>
      {container.samples.length === 0 ? (
        <p className="text-xs text-muted-foreground">No pre-shipment sample raised yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {container.samples.map((s) => (
            <PssRow key={s.id} sample={s} />
          ))}
        </div>
      )}
      {canDraw && (
        <Button variant="outline" size="sm" className="self-start" disabled={drawing} onClick={() => onDraw(container.container_no)}>
          <IconPlus className="size-3.5" /> {drawing ? 'Drawing…' : 'Draw next option'}
        </Button>
      )}
    </div>
  );
}

export default function ContractDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useContract(id);
  const draw = useDrawPss();
  const del = useDeleteRecord('/contracts');
  const event = useRecordHighlight(id);

  const [editOpen, setEditOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <Link to="/contracts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <IconArrowLeft className="size-3.5" /> Back to contracts
        </Link>
        <p className="text-sm text-muted-foreground">This contract could not be found.</p>
      </div>
    );
  }

  // useContract's generic Detail type is the loose record every drawer shares; narrow it to the
  // contract shape this page renders.
  const data = query.data as unknown as ContractDetail;
  const counts = data.pss_counts;

  function handleDraw(containerNo: number) {
    setError(null);
    draw.mutate(
      { contractId: id, containerNo },
      { onError: () => setError(`Could not draw an option into slot ${containerNo}. Refresh and try again.`) },
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link to="/contracts" className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <IconArrowLeft className="size-3.5" /> Back to contracts
      </Link>

      {event && <HighlightBanner event={event} />}

      {/* Header: the contract, its client, where it stands */}
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">{data.contract_number}</h1>
            <StatusBadge kind="contract_status" value={data.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {data.client_id ? (
              <Link to={`/clients/${data.client_id}`} className="text-primary hover:underline">
                {data.client?.name ?? data.client_name ?? 'Client'}
              </Link>
            ) : (
              data.client_name ?? 'No client on file'
            )}
            {data.quality && <> · {data.quality}</>}
            {data.destination && <> → {data.destination}</>}
            {data.po_ref && <> · PO {data.po_ref}</>}
          </p>
          <p className="text-sm text-muted-foreground">
            {data.shipment_date ? `Ship ${String(data.shipment_date).slice(0, 10)}` : 'No shipment date'}
            {data.shipment_month && !data.shipment_date ? ` (${data.shipment_month})` : ''} ·{' '}
            <DueLine due={data.pss_due_date} />
          </p>
          {counts && (
            <p className="text-sm text-muted-foreground">
              {counts.approved} of {counts.expected} PSS options approved
              {data.pss_qty_grams ? ` · ${data.pss_qty_grams >= 1000 && data.pss_qty_grams % 1000 === 0 ? `${data.pss_qty_grams / 1000} kg` : `${data.pss_qty_grams} g`} per option` : ''}
              {counts.rejected > 0 && <span className="text-rose-600 dark:text-rose-400"> · {counts.rejected} replacement rejected</span>}
            </p>
          )}
          {data.client?.account_owner && (
            <p className="text-xs text-muted-foreground">Account manager: {data.client.account_owner.name}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <IconPencil className="size-3.5" /> Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
            <IconTrash className="size-3.5" /> Delete
          </Button>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* One card per option slot — its state and the lettered options raised in it */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">PSS options</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Lettered options (A, B, C…), due 45 days before shipment. A rejected option is replaced in the same slot with the next letter.
        </p>
        {data.containers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No PSS options expected on this contract.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.containers.map((c) => (
              <ContainerCard key={c.container_no} container={c} onDraw={handleDraw} drawing={draw.isPending} />
            ))}
          </div>
        )}
      </section>

      {/* Samples on this contract that no slot claimed */}
      {data.unassigned?.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-medium text-foreground">Not in an option slot</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Linked to this contract without a slot, or past the expected number of options.
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            {data.unassigned.map((s) => (
              <PssRow key={s.id} sample={s} />
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Timeline</h2>
        <div className="mt-3">
          <Timeline events={data.events ?? []} />
        </div>
      </section>

      <ContractFormDialog
        mode="edit"
        open={editOpen}
        onOpenChange={setEditOpen}
        contract={{
          id: data.id,
          contract_number: data.contract_number,
          client_id: data.client_id,
          client_name: data.client_name,
          quality: data.quality,
          destination: data.destination,
          shipment_date: data.shipment_date,
          containers: Array.isArray(data.containers) ? data.containers.length : null,
          pss_expected: data.pss_expected,
          po_ref: data.po_ref ?? null,
          pss_qty_grams: data.pss_qty_grams ?? null,
          notes: data.notes,
        }}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete {data.contract_number}?</DialogTitle>
            <DialogDescription>
              This removes the contract from active lists and stops its PSS reminders. The samples already
              drawn are kept. The Quality team is notified of deletions.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={del.isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={del.isPending}
              onClick={() =>
                del.mutate(id, {
                  onSuccess: () => {
                    setConfirmOpen(false);
                    navigate('/contracts');
                  },
                  onError: () => setError('Failed to delete the contract. Please try again.'),
                })
              }
            >
              {del.isPending ? 'Deleting…' : 'Delete contract'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
