import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { IconArrowLeft, IconPrinter, IconTrash, IconX, IconPlus } from '@tabler/icons-react';

import { useRecord, usePatchRecord, useDeleteRecord, useConsignmentMembers } from '@/lib/query';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Timeline } from '@/components/Timeline';
import { StatusBadge } from '@/components/StatusBadge';
import { HighlightBanner } from '@/components/HighlightBanner';
import { useRecordHighlight } from '@/lib/highlight';
import { formatLocation } from '@/lib/format';
import { openPrintLabel, consignmentLabelData } from '@/components/print-label';
import type { EventRow } from '@/types';

const UNASSIGNED = '__unassigned__';
const LOCATIONS = ['westlands', 'thika'];
const STATUSES = ['open', 'dispatched', 'closed'];

type Member = { tab: string; id: string; ref: string | null; title: string | null; receiver: string | null; status: string | null };
type ConsignmentDetail = {
  id: string; number: string; location: string | null; status: string; notes: string | null;
  member_count: number; members: Member[]; events?: EventRow[];
};

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

  function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    const ref = addRef.trim();
    if (!ref) return;
    setAddError(null);
    add.mutate(ref, {
      onSuccess: () => setAddRef(''),
      onError: (err) => setAddError(err instanceof Error ? err.message : 'Could not add that sample.'),
    });
  }

  // Dashboard route per book (specialty lives at /samples).
  const memberHref = (m: Member) => `${m.tab === 'specialty' ? '/samples' : `/${m.tab}`}/${m.id}`;

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link to="/consignments" className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <IconArrowLeft className="size-3.5" /> Back to consignments
      </Link>

      {event && <HighlightBanner event={event} />}

      {/* Header: number + member count + delete */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{data.number}</h1>
          <p className="text-sm text-muted-foreground">
            {data.member_count} sample{data.member_count === 1 ? '' : 's'}
            {data.location ? ` · ${formatLocation(data.location)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Feedback ⑫: physical label for the consignment box. */}
          <Button variant="outline" size="sm" onClick={() => openPrintLabel(consignmentLabelData(data))}>
            <IconPrinter className="size-3.5" /> Print label
          </Button>
          <Button variant="outline" size="sm" onClick={() => del.mutate(id, { onSuccess: () => navigate('/consignments') })}>
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
            onChange={(e) => setAddRef(e.target.value)}
            placeholder="Add by ref or AWB, e.g. SL-8000"
            className="h-8 w-60 rounded-[4px] border border-border bg-background px-2.5 text-sm outline-none focus:border-primary"
          />
          <Button type="submit" size="sm" variant="outline" disabled={add.isPending || !addRef.trim()}>
            <IconPlus className="size-3.5" /> Add
          </Button>
          {addError && <span className="text-xs text-destructive">{addError}</span>}
        </form>

        {data.members.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No samples grouped yet.</p>
        ) : (
          <div className="mt-3 flex flex-col divide-y divide-border">
            {data.members.map((m) => (
              <div key={`${m.tab}-${m.id}`} className="flex items-center gap-3 py-2 text-sm">
                <Link to={memberHref(m)} className="font-medium text-foreground hover:underline">
                  {m.ref || '(no ref)'}
                </Link>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {m.title || '—'}{m.receiver ? ` → ${m.receiver}` : ''}
                </span>
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
            ))}
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
    </div>
  );
}
