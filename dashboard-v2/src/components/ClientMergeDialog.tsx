import * as React from 'react';
import { IconArrowMerge, IconSearch, IconSwitchHorizontal } from '@tabler/icons-react';

import { useClients, useMergeCandidates, useMergeClients, useRecord } from '@/lib/query';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ClientDetail } from '@/components/client-types';

export type ClientMergeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The client currently on screen (the default SOURCE — it folds into the picked target). */
  client: ClientDetail;
  /** Called after a successful merge with the surviving client's id — the page navigates there. */
  onMerged: (targetId: string) => void;
};

type Counts = { contacts: number; specialty: number; bulk: number; forwarding: number; hasAddress: boolean };

function countsOf(c: ClientDetail | undefined): Counts {
  const orders = c?.orders ?? [];
  return {
    contacts: c?.contacts?.length ?? 0,
    specialty: orders.filter((o) => o.tab === 'specialty').length,
    bulk: orders.filter((o) => o.tab === 'bulk').length,
    forwarding: orders.filter((o) => o.tab === 'forwarding').length,
    hasAddress: (c?.contacts ?? []).some((ct) => (ct.full_address ?? '').trim().length > 0),
  };
}

function CountsRow({ label, name, counts, role }: { label: string; name: string; counts: Counts; role: 'keep' | 'fold' }) {
  return (
    <div className={cn('rounded-[4px] border p-3', role === 'keep' ? 'border-foreground/30 bg-accent/40' : 'border-border')}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-foreground" title={name}>{name}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {counts.contacts} contact{counts.contacts === 1 ? '' : 's'}{counts.hasAddress ? ' · has address' : ' · no address'}
        {' · '}
        {counts.specialty} specialty · {counts.bulk} bulk · {counts.forwarding} forwarding
      </p>
    </div>
  );
}

/**
 * "Merge into…" for duplicate clients (feedback #27 — "Paulig" vs "Gustav Paulig Ltd (NEW) Jan 23").
 * Pick the other entry (candidates with a matching normalized name are pre-suggested; the search box
 * covers the rest), preview what moves, confirm. Server folds samples + contacts into the kept entry
 * and soft-deletes the other, so it drops off the Clients list on its own.
 */
export function ClientMergeDialog({ open, onOpenChange, client, onMerged }: ClientMergeDialogProps) {
  const [q, setQ] = React.useState('');
  const [pickedId, setPickedId] = React.useState<string | null>(null);
  // Default: this client folds INTO the picked one. `keepThis` flips it (picked folds into this one).
  const [keepThis, setKeepThis] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const candidates = useMergeCandidates(open ? client.id : '');
  const search = useClients({ sort: null, filters: q.trim() ? { q: q.trim() } : {}, page: 1, pageSize: 25 });
  const picked = useRecord('/clients', pickedId ?? '');
  const merge = useMergeClients();

  React.useEffect(() => {
    if (!open) return;
    setQ('');
    setPickedId(null);
    setKeepThis(false);
    setError(null);
  }, [open, client.id]);

  // Once candidates load, pre-select the fullest one (address first, then contacts) if nothing picked.
  React.useEffect(() => {
    if (!open || pickedId || !candidates.data?.data.length) return;
    const best = [...candidates.data.data].sort((a, b) =>
      Number(b.has_address) - Number(a.has_address) || b.contact_count - a.contact_count || b.sample_count - a.sample_count)[0];
    setPickedId(best.id);
    // Keep the entry that has an address: if this one has an address and the best candidate doesn't, keep this.
    const thisHasAddress = countsOf(client).hasAddress;
    if (thisHasAddress && !best.has_address) setKeepThis(true);
  }, [open, pickedId, candidates.data, client]);

  const candidateIds = new Set((candidates.data?.data ?? []).map((c) => c.id));
  const searchRows = ((search.data?.data ?? []) as Array<Record<string, unknown>>)
    .filter((r) => String(r.id) !== client.id && !candidateIds.has(String(r.id)));

  const pickedDetail = picked.data as unknown as ClientDetail | undefined;
  const thisCounts = countsOf(client);
  const pickedCounts = countsOf(pickedDetail);
  const pickedName = pickedDetail?.name ?? (candidates.data?.data.find((c) => c.id === pickedId)?.name ?? '');

  const targetId = keepThis ? client.id : pickedId;
  const sourceId = keepThis ? pickedId : client.id;
  const targetName = keepThis ? client.name : pickedName;
  const sourceName = keepThis ? pickedName : client.name;
  const sourceCounts = keepThis ? pickedCounts : thisCounts;

  function handleMerge() {
    if (!targetId || !sourceId) return;
    setError(null);
    merge.mutate(
      { targetId, sourceIds: [sourceId] },
      {
        onSuccess: (r) => {
          onOpenChange(false);
          onMerged(r.target.id);
        },
        onError: (e) => setError(e instanceof Error ? e.message.replace(/^\d+:\s*/, '') : 'Merge failed. Please try again.'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Merge {client.name} into…</DialogTitle>
          <DialogDescription>
            Pick the duplicate entry. Samples and contacts move to the kept client; the other one is removed from
            the list (history is kept for audit).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Suggested duplicates */}
          {candidates.data && candidates.data.data.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Likely the same company</p>
              <div className="flex flex-col gap-1">
                {candidates.data.data.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setPickedId(c.id)}
                    className={cn(
                      'flex items-center justify-between rounded-[4px] border px-3 py-2 text-left text-sm hover:bg-accent/60',
                      pickedId === c.id ? 'border-foreground/40 bg-accent' : 'border-border',
                    )}
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="ml-3 shrink-0 text-xs text-muted-foreground">
                      {c.contact_count} contact{c.contact_count === 1 ? '' : 's'}{c.has_address ? ' · address' : ''} · {c.sample_count} samples
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search for any other client */}
          <div>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search other clients…"
                className="pl-7"
                autoFocus={!candidates.data?.data.length}
              />
            </div>
            {q.trim() && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-[4px] border border-border">
                {searchRows.length === 0 ? (
                  <p className="p-2 text-xs text-muted-foreground">{search.isLoading ? 'Searching…' : 'No other clients match.'}</p>
                ) : (
                  searchRows.map((r) => (
                    <button
                      key={String(r.id)}
                      type="button"
                      onClick={() => setPickedId(String(r.id))}
                      className={cn(
                        'flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-accent/60',
                        pickedId === String(r.id) && 'bg-accent',
                      )}
                    >
                      <span className="truncate">{String(r.name)}</span>
                      <span className="ml-3 shrink-0 text-xs text-muted-foreground">
                        {String(r.country ?? '')}{r.contact_count != null ? ` · ${String(r.contact_count)} contacts` : ''}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Preview */}
          {pickedId && (
            <div className="flex flex-col gap-2">
              <CountsRow label="Keep" name={targetName || '…'} counts={keepThis ? thisCounts : pickedCounts} role="keep" />
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <IconArrowMerge className="size-3.5" />
                <span>
                  moves {sourceCounts.contacts} contact{sourceCounts.contacts === 1 ? '' : 's'} and{' '}
                  {sourceCounts.specialty + sourceCounts.bulk + sourceCounts.forwarding} sample rows into the kept client
                </span>
                <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setKeepThis((v) => !v)}>
                  <IconSwitchHorizontal className="size-3.5" /> Swap
                </Button>
              </div>
              <CountsRow label="Fold in (removed)" name={sourceName || '…'} counts={sourceCounts} role="fold" />
              {picked.isLoading && <p className="text-xs text-muted-foreground">Loading counts…</p>}
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={merge.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={handleMerge} disabled={!pickedId || merge.isPending || picked.isLoading}>
            {merge.isPending ? 'Merging…' : `Merge into ${targetName || '…'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
