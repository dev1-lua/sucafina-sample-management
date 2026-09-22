import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { IconArrowLeft, IconPrinter, IconTrash, IconTruckDelivery, IconX, IconPlus } from '@tabler/icons-react';

import {
  useRecord,
  usePatchRecord,
  useDeleteRecord,
  useConsignmentMembers,
  useDispatchConsignment,
  resolveSampleRef,
  type SampleCandidate,
} from '@/lib/query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Timeline } from '@/components/Timeline';
import { StatusBadge } from '@/components/StatusBadge';
import { HighlightBanner } from '@/components/HighlightBanner';
import { useRecordHighlight } from '@/lib/highlight';
import { formatLocation, formatQty } from '@/lib/format';
import { openPrintLabel, consignmentLabelData } from '@/components/print-label';
import type { EventRow } from '@/types';

const UNASSIGNED = '__unassigned__';
const LOCATIONS = ['westlands', 'thika'];
const STATUSES = ['open', 'dispatched', 'closed'];
// The books' courier options (tabs/*.tsx) — the dispatch dialog offers the same list.
const COURIERS = ['dhl', 'fedex', 'ups', 'rider', 'hand_delivery', 'client_pickup', 'wells_fargo', 'other'];

type Member = {
  tab: string; id: string; ref: string | null; title: string | null; receiver: string | null; status: string | null;
  // Round 10 (contracts §6): the coffee and the parcel, so the order reads like the book row.
  outturn?: string | null; grade?: string | null; sample_type_norm?: string | null; qty_grams?: number | null;
  awb?: string | null; courier_norm?: string | null; dispatched_on?: string | null; date_on?: string | null;
  // Label-line extra (migration 016): contract/container on PSS. Optional — older API builds omit them.
  contract_number?: string | null; container_no?: number | null;
};
type ConsignmentDetail = {
  id: string; number: string; location: string | null; status: string; notes: string | null;
  member_count: number; members: Member[]; events?: EventRow[]; created_at?: string;
  // Round 10 (contracts §6): the order's client, who asked, who logged it, and where it stands.
  client_id?: string | null; client_name?: string | null; requested_by?: string | null; logged_by?: string | null;
  derived_status?: string | null;
};

/** "08KN0021 · AB" for a specialty lot, else the title (quality) the row goes by. */
function memberCoffee(m: Member): string {
  const lot = [m.outturn, m.grade].filter((p): p is string => !!p).join(' · ');
  return lot || m.title || '—';
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Courier + AWB (+ date) applied to every live member in one go (POST /consignments/:id/dispatch). */
function DispatchAllDialog({
  open,
  onOpenChange,
  consignmentId,
  memberCount,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  consignmentId: string;
  memberCount: number;
}) {
  const dispatch = useDispatchConsignment(consignmentId);
  const [courier, setCourier] = React.useState('');
  const [awb, setAwb] = React.useState('');
  const [date, setDate] = React.useState(todayIso);
  React.useEffect(() => {
    if (open) {
      setCourier('');
      setAwb('');
      setDate(todayIso());
      dispatch.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!courier || !awb.trim()) return;
    dispatch.mutate(
      { courier, awb: awb.trim(), ...(date ? { dispatched_on: date } : {}) },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Dispatch all</DialogTitle>
            <DialogDescription>
              One courier and AWB for the whole box: every sample in this order is marked dispatched, and the
              usual notifications go out per sample.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Courier</span>
            <NativeSelect value={courier} onChange={(e) => setCourier(e.target.value)} required aria-label="Courier">
              <option value="">Select…</option>
              {COURIERS.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ')}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AWB</span>
            <Input value={awb} onChange={(e) => setAwb(e.target.value)} required aria-label="AWB" placeholder="1234567890" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Dispatched on</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Dispatched on" />
          </label>
          {dispatch.isError && <p className="text-sm text-destructive">Failed to dispatch. Please try again.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={dispatch.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={dispatch.isPending || !courier || !awb.trim()}>
              {dispatch.isPending ? 'Dispatching…' : `Dispatch ${memberCount} sample${memberCount === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ConsignmentDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useRecord('/consignments', id);
  const patch = usePatchRecord('/consignments');
  const del = useDeleteRecord('/consignments');
  const { add, remove } = useConsignmentMembers(id);
  const event = useRecordHighlight(id);

  const [addRef, setAddRef] = React.useState('');
  const [addError, setAddError] = React.useState<string | null>(null);
  const [resolving, setResolving] = React.useState(false);
  // Several sends share a ref (round 10): when the typed ref matches more than one, ask which.
  const [candidates, setCandidates] = React.useState<SampleCandidate[] | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [dispatchOpen, setDispatchOpen] = React.useState(false);

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
        <Link to="/consignments" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <IconArrowLeft className="size-3.5" /> Back to consignments
        </Link>
        <p className="text-sm text-muted-foreground">This consignment could not be found.</p>
      </div>
    );
  }

  const data = query.data as unknown as ConsignmentDetail;

  function addMember(c: SampleCandidate) {
    setCandidates(null);
    setAddError(null);
    add.mutate(
      { tab: c.tab, id: c.id },
      {
        onSuccess: () => setAddRef(''),
        onError: (err) => setAddError(err instanceof Error ? err.message : 'Could not add that sample.'),
      },
    );
  }

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    const ref = addRef.trim();
    if (!ref) return;
    setAddError(null);
    setCandidates(null);
    setResolving(true);
    try {
      const found = await resolveSampleRef(ref);
      if (found.length === 0) setAddError(`No sample matching "${ref}"`);
      else if (found.length === 1) addMember(found[0]!);
      else setCandidates(found);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not look that ref up.');
    } finally {
      setResolving(false);
    }
  }

  // Dashboard route per book (specialty lives at /samples).
  const memberHref = (m: { tab: string; id: string }) => `${m.tab === 'specialty' ? '/samples' : `/${m.tab}`}/${m.id}`;
  const created = data.created_at ? data.created_at.slice(0, 10) : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link to="/consignments" className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <IconArrowLeft className="size-3.5" /> Back to consignments
      </Link>

      {event && <HighlightBanner event={event} />}

      {/* Header: number + client + who asked / logged + derived status + actions */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">{data.number}</h1>
            {data.derived_status && <StatusBadge kind="order_status" value={data.derived_status} />}
          </div>
          <p className="text-sm text-muted-foreground">
            {data.client_name ? (
              data.client_id ? (
                <Link to={`/clients/${data.client_id}`} className="font-medium text-foreground underline-offset-2 hover:underline">
                  {data.client_name}
                </Link>
              ) : (
                <span className="font-medium text-foreground">{data.client_name}</span>
              )
            ) : (
              'No client'
            )}
            {' · '}
            {data.member_count} sample{data.member_count === 1 ? '' : 's'}
            {data.location ? ` · ${formatLocation(data.location)}` : ''}
            {created ? ` · ${created}` : ''}
          </p>
          {(data.requested_by || data.logged_by) && (
            <p className="text-xs text-muted-foreground">
              {data.requested_by ? `Requested by ${data.requested_by}` : ''}
              {data.requested_by && data.logged_by ? ' · ' : ''}
              {data.logged_by ? `Logged by ${data.logged_by}` : ''}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setDispatchOpen(true)} disabled={data.members.length === 0}>
            <IconTruckDelivery className="size-3.5" /> Dispatch all
          </Button>
          {/* Feedback ⑫: physical label for the consignment box. */}
          <Button variant="outline" size="sm" onClick={() => openPrintLabel(consignmentLabelData(data))}>
            <IconPrinter className="size-3.5" /> Print label
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
            <IconTrash className="size-3.5" /> Delete
          </Button>
        </div>
      </div>

      {/* Location + status assignment (feedback ⑧) */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Location &amp; status</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Select
            value={data.location ?? UNASSIGNED}
            onValueChange={(v) => patch.mutate({ id, body: { location: v === UNASSIGNED ? null : v } })}
          >
            <SelectTrigger className="w-52"><SelectValue placeholder="Lab" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              {LOCATIONS.map((l) => (
                <SelectItem key={l} value={l}>{formatLocation(l)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={data.status} onValueChange={(v) => patch.mutate({ id, body: { status: v } })}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {patch.isPending && <span className="text-xs text-muted-foreground">Saving…</span>}
        </div>
      </section>

      {/* Members (feedback ⑥) */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">Samples in this consignment</h2>
        </div>

        <form onSubmit={submitAdd} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={addRef}
            onChange={(e) => {
              setAddRef(e.target.value);
              setCandidates(null);
            }}
            placeholder="Add by ref, e.g. SL-8000"
            className="h-8 w-60 rounded-[4px] border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
          />
          <Button type="submit" size="sm" variant="outline" disabled={add.isPending || resolving || !addRef.trim()}>
            <IconPlus className="size-3.5" /> Add
          </Button>
          {addError && <span className="text-xs text-destructive">{addError}</span>}
        </form>

        {candidates && (
          <div role="group" aria-label="Which send?" className="mt-2 flex flex-col gap-1 rounded-[4px] border border-border bg-muted/40 p-2">
            <p className="px-1 text-xs text-muted-foreground">
              {candidates[0]?.ref} has been sent {candidates.length} times — which one goes in this order?
            </p>
            {candidates.map((c) => (
              <button
                key={`${c.tab}-${c.id}`}
                type="button"
                onClick={() => addMember(c)}
                className="flex items-center gap-3 rounded-[4px] px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1 truncate">{c.receiver || '—'}</span>
                <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{c.date_on ? c.date_on.slice(0, 10) : '—'}</span>
                <StatusBadge kind="status" value={c.status} />
                {c.consignment_number && <span className="text-xs text-muted-foreground">in {c.consignment_number}</span>}
              </button>
            ))}
          </div>
        )}

        {data.members.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No samples grouped yet.</p>
        ) : (
          <div className="mt-3 flex flex-col divide-y divide-border">
            {data.members.map((m) => {
              const courier = [m.courier_norm, m.awb].filter(Boolean).join(' · ');
              return (
                <div key={`${m.tab}-${m.id}`} className="flex items-center gap-3 py-2 text-sm">
                  <Link to={memberHref(m)} className="w-28 shrink-0 font-medium text-foreground hover:underline">
                    {m.ref || '(no ref)'}
                  </Link>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{memberCoffee(m)}</span>
                  <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{formatQty(m.qty_grams) ?? '—'}</span>
                  <span className="hidden w-32 shrink-0 truncate text-xs text-muted-foreground sm:inline">{courier || '—'}</span>
                  <StatusBadge kind="status" value={m.status} />
                  <button
                    type="button"
                    aria-label="Remove from consignment"
                    onClick={() => remove.mutate({ tab: m.tab, id: m.id })}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <IconX className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Timeline */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Timeline</h2>
        <div className="mt-3">
          <Timeline events={data.events ?? []} />
        </div>
      </section>

      <DispatchAllDialog open={dispatchOpen} onOpenChange={setDispatchOpen} consignmentId={id} memberCount={data.members.length} />

      {/* Same confirm-then-soft-delete pattern as DetailDrawer / ClientDeleteDialog. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {data.number}?</DialogTitle>
            <DialogDescription>
              This removes the consignment from the list; the samples in it are kept and freed to regroup.
              It can&rsquo;t be undone from the dashboard. The Quality team is notified of deletions.
            </DialogDescription>
          </DialogHeader>
          {del.isError && <p className="text-sm text-destructive">Failed to delete. Please try again.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={del.isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={del.isPending}
              onClick={() => del.mutate(id, { onSuccess: () => { setConfirmOpen(false); navigate('/consignments'); } })}
            >
              {del.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
