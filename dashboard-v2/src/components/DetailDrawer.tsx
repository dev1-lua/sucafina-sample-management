import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { IconAlertTriangle, IconPrinter, IconRepeat, IconTrash, IconX } from '@tabler/icons-react';

import { useRecord, usePatchRecord, useDeleteRecord, useLotSends, useTeamRoster, type LotSend } from '@/lib/query';
import { cn } from '@/lib/cn';
import { formatShortDate } from '@/lib/format';
import { tagColor } from '@/lib/tags';
import { TAB_REGISTRY } from '@/tabs/registry';
import type { DetailField, EventRow, TabKey } from '@/types';
import { StatusBadge } from '@/components/StatusBadge';
import { NativeSelect } from '@/components/ui/native-select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EditableSelect } from '@/components/EditableSelect';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Timeline } from '@/components/Timeline';
import { openPrintLabel, sampleLabelData } from '@/components/print-label';
import { HighlightBanner } from '@/components/HighlightBanner';
import { useRecordHighlight } from '@/lib/highlight';

export type DetailDrawerProps = {
  endpoint: string;
  id: string;
  open: boolean;
  onClose: () => void;
  fields: DetailField[];
  entityLabel?: string;
};

type RowData = Record<string, unknown>;

const DETAIL_SLIDE_TRANSITION = { duration: 0.18, ease: 'easeOut' } as const;

function displayValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">—</span>;
  }
  return String(value);
}

/** Mirrors RecordTable's inline-edit-cell contract (commit-on-blur/Enter for text,
 * commit-on-select for select) but laid out as a full-width field row instead of a
 * table cell. */
function InlineEditField({
  editDef,
  row,
  onCommit,
}: {
  editDef: NonNullable<DetailField['edit']>;
  row: RowData;
  onCommit: (field: string, value: string | number) => void;
}) {
  const initial = row[editDef.field];
  // Date columns arrive as full ISO timestamps; a date input needs plain YYYY-MM-DD.
  const initialStr =
    initial === null || initial === undefined
      ? ''
      : editDef.type === 'date'
        ? String(initial).slice(0, 10)
        : String(initial);
  const [value, setValue] = React.useState(initialStr);

  React.useEffect(() => {
    setValue(initialStr);
  }, [initialStr]);

  function commit(next: string) {
    if (next === initialStr) return;
    // Number fields PATCH a real number (int-typed API columns reject strings);
    // an emptied number input is a no-op — COALESCE can't null a field anyway.
    if (editDef.type === 'number') {
      if (next.trim() === '' || Number.isNaN(Number(next))) return;
      onCommit(editDef.field, Number(next));
      return;
    }
    // A cleared date input is a no-op (the API's COALESCE can't null a field anyway).
    if (editDef.type === 'date' && next.trim() === '') return;
    onCommit(editDef.field, next);
  }

  if (editDef.type === 'select') {
    if (editDef.allowCustom) {
      // Editable select: pick a preset or choose "Other…" to type a custom value.
      // EditableSelect manages its own select/input state and re-syncs from `value`
      // (the committed server value) after each PATCH.
      return <EditableSelect value={initialStr} options={editDef.options ?? []} onCommit={commit} />;
    }
    return (
      <Select
        value={value}
        onValueChange={(next) => {
          setValue(next);
          commit(next);
        }}
      >
        <SelectTrigger className="h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(editDef.options ?? []).map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      className="h-8 text-sm"
      type={editDef.type === 'number' ? 'number' : editDef.type === 'date' ? 'date' : 'text'}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => commit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** Muted strip for a soft-deleted record: old deep links still resolve via GET /:id,
 * so say plainly that the row is gone from the lists instead of looking live. */
function RemovedBanner({ deletedAt }: { deletedAt: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[4px] bg-muted px-3 py-2 text-sm text-muted-foreground">
      <IconTrash className="size-4 shrink-0" aria-hidden="true" />
      <span>Removed on {formatShortDate(deletedAt) ?? deletedAt.slice(0, 10)}</span>
    </div>
  );
}

/** Amber strip (same shape as HighlightBanner, gap palette) when the sample's client has
 * no delivery address on file — names who was asked and links to the client page where
 * the address gets added. Icon + text, so colour is never the only signal. */
function AddressGapBanner({ row }: { row: RowData }) {
  const who = typeof row.details_requested_from === 'string' && row.details_requested_from.trim() !== '' ? row.details_requested_from.trim() : null;
  const when = formatShortDate(row.details_requested_at);
  const client =
    [row.client, row.receiver_company, row.client_name, row.receiver].find(
      (v): v is string => typeof v === 'string' && v.trim() !== '',
    ) ?? 'this client';
  const clientId = typeof row.client_id === 'string' && row.client_id !== '' ? row.client_id : null;
  return (
    <div className={cn('flex items-start gap-2 rounded-[4px] px-3 py-2 text-sm', tagColor('gap', 'address_needed'))}>
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        No delivery address on file for {client} — {who ? `asked ${who}${when ? ` on ${when}` : ''}` : 'nobody asked yet'}.
        {clientId && (
          <>
            {' '}
            <Link to={`/clients/${clientId}`} className="font-medium underline-offset-2 hover:underline">
              Add address
            </Link>
          </>
        )}
      </span>
    </div>
  );
}

// --- Round 10: lots, orders and loop-ins ---------------------------------------------------------
type DrawerTab = 'details' | 'timeline' | 'related';
const SAMPLE_BOOKS: TabKey[] = ['specialty', 'bulk', 'forwarding'];
const MAX_LOOP_INS = 20; // the PATCH schema's cap on notify_trader_ids

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** Dashboard route for a send by the book it lives in (`tab` on API rows). */
function pathForTab(tab: unknown): string {
  const key = SAMPLE_BOOKS.find((k) => k === tab);
  return key ? TAB_REGISTRY[key].path : TAB_REGISTRY.specialty.path;
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th", 22 → "22nd". */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

function sendTime(s: LotSend): number {
  const t = s.date_on ? Date.parse(s.date_on) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

/** Which send of its coffee this row is, counting oldest first (the row's own position in
 * the lot's sends); falls back to the row's `lot_sends` count until the sends have loaded. */
function sendOrdinal(id: string, lotSends: number, sends: LotSend[] | undefined): number {
  if (!sends) return lotSends;
  const oldestFirst = [...sends].reverse().sort((a, b) => sendTime(a) - sendTime(b));
  const index = oldestFirst.findIndex((s) => s.id === id);
  return index === -1 ? lotSends : index + 1;
}

/** Muted strip on a re-sent coffee: "Re-send · 3rd send of this coffee — see all" (→ Related). */
function ResendBanner({ n, onSeeAll }: { n: number; onSeeAll: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-[4px] bg-muted px-3 py-2 text-sm text-muted-foreground">
      <IconRepeat className="size-4 shrink-0" aria-hidden="true" />
      <span>
        Re-send · {ordinal(n)} send of this coffee —{' '}
        <button
          type="button"
          onClick={onSeeAll}
          className="rounded-[2px] font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          see all
        </button>
      </span>
    </div>
  );
}

function RelatedSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const RELATED_ROW =
  'flex w-full items-center gap-3 rounded-[4px] px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Related tab: the coffee's other sends (from GET /lots/:ref) and the order this send is in. */
function RelatedTab({
  row,
  id,
  lotRef,
  lotSends,
  sends,
  sendsLoading,
  sendsError,
}: {
  row: RowData;
  id: string;
  lotRef: string | null;
  lotSends: number;
  sends: LotSend[] | undefined;
  sendsLoading: boolean;
  sendsError: boolean;
}) {
  const navigate = useNavigate();
  const consignmentId = str(row.consignment_id);
  const order = useRecord('/consignments', consignmentId ?? '');
  const members = Array.isArray(order.data?.members) ? (order.data!.members as RowData[]) : [];
  const others = (sends ?? []).filter((s) => s.id !== id);

  return (
    <div className="flex flex-col gap-5 pt-2">
      <RelatedSection title={lotRef && lotSends > 1 ? `Other sends of ${lotRef}` : 'Other sends'}>
        {!lotRef || lotSends <= 1 ? (
          <p className="text-sm text-muted-foreground">No other sends of this coffee.</p>
        ) : sendsLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : sendsError ? (
          <p className="text-sm text-muted-foreground">Couldn’t load the other sends.</p>
        ) : others.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other sends of this coffee.</p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {others.map((s) => (
              <li key={`${s.tab}-${s.id}`} data-send>
                <button type="button" className={RELATED_ROW} onClick={() => navigate(`${pathForTab(s.tab)}/${s.id}`)}>
                  <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{s.date_on ? s.date_on.slice(0, 10) : '—'}</span>
                  <span className="min-w-0 flex-1 truncate">{s.receiver || '—'}</span>
                  <StatusBadge kind="status" value={s.status} />
                  <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">
                    {[s.courier_norm, s.awb].filter(Boolean).join(' · ') || '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </RelatedSection>

      <RelatedSection
        title={consignmentId ? `Order ${str(row.consignment_number) ?? ''}`.trim() : 'Order'}
        action={
          consignmentId ? (
            <Link to={`/consignments/${consignmentId}`} className="text-xs font-medium text-primary underline-offset-2 hover:underline">
              Open order
            </Link>
          ) : undefined
        }
      >
        {!consignmentId ? (
          <p className="text-sm text-muted-foreground">Not part of an order.</p>
        ) : order.isLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : order.isError ? (
          <p className="text-sm text-muted-foreground">Couldn’t load the order.</p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {members.map((m) => {
              const isThis = String(m.id) === id;
              return (
                <li key={`${String(m.tab)}-${String(m.id)}`}>
                  <button
                    type="button"
                    className={cn(RELATED_ROW, isThis && 'bg-muted/50')}
                    onClick={() => navigate(`${pathForTab(m.tab)}/${String(m.id)}`)}
                    aria-current={isThis ? 'true' : undefined}
                  >
                    <span className="w-24 shrink-0 font-medium">{str(m.ref) ?? '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {str(m.title) ?? '—'}
                      {str(m.receiver) ? ` → ${String(m.receiver)}` : ''}
                    </span>
                    <StatusBadge kind="status" value={str(m.status)} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </RelatedSection>
    </div>
  );
}

/** The account manager's display name from a joined `account_owner` (trader row) or a bare name. */
function ownerNameOf(owner: unknown): string | null {
  if (typeof owner === 'string') return str(owner);
  if (owner && typeof owner === 'object' && 'name' in owner) return str((owner as { name?: unknown }).name);
  return null;
}

/** Details-tab section: who else hears about this sample. Chips for `notify_trader_ids`
 * (names via the roster), an "Add…" select of active colleagues not yet listed, and the
 * client's account manager read-only — from the row when it carries `account_owner`, else
 * from the client record (`client_id`; the sample routes return the bare row today). Every
 * change PATCHes the full array (the API replaces it wholesale). */
function LoopInSection({ row, onCommit }: { row: RowData; onCommit: (ids: string[]) => void }) {
  const roster = useTeamRoster();
  const ids = Array.isArray(row.notify_trader_ids) ? row.notify_trader_ids.filter((v): v is string => typeof v === 'string') : [];
  const byId = new Map((roster.data ?? []).map((m) => [m.id, m]));
  const candidates = (roster.data ?? []).filter((m) => m.active && !ids.includes(m.id));
  const rowOwner = ownerNameOf(row.account_owner);
  const clientId = rowOwner ? null : str(row.client_id);
  const client = useRecord('/clients', clientId ?? '');
  const ownerName = rowOwner ?? ownerNameOf(client.data?.account_owner);

  return (
    <div className="flex flex-col gap-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">In the loop</dt>
      <dd className="flex flex-col gap-2 text-sm text-foreground">
        <div className="flex flex-wrap items-center gap-1.5">
          {ids.map((id) => {
            const name = byId.get(id)?.name ?? (roster.isLoading ? '…' : 'Unknown');
            return (
              <span key={id} className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-background pl-2.5 text-xs">
                {name}
                <button
                  type="button"
                  aria-label={`Remove ${name} from the loop`}
                  onClick={() => onCommit(ids.filter((v) => v !== id))}
                  className="flex h-full items-center rounded-r-full pl-1 pr-2 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <IconX className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            );
          })}
          <NativeSelect
            aria-label="Add to the loop"
            value=""
            disabled={ids.length >= MAX_LOOP_INS || candidates.length === 0}
            onChange={(e) => e.target.value && onCommit([...ids, e.target.value])}
            className="h-7 text-xs"
          >
            <option value="">Add…</option>
            {candidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        {ownerName && <p className="text-xs text-muted-foreground">Account manager: {ownerName}</p>}
      </dd>
    </div>
  );
}

function DetailsSkeleton() {
  return (
    <div className="flex flex-col gap-4 pt-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  );
}

export function DetailDrawer({ endpoint, id, open, onClose, fields, entityLabel }: DetailDrawerProps) {
  const query = useRecord(endpoint, id);
  const { mutate: patchRecord } = usePatchRecord(endpoint);
  const { mutate: deleteRecord, isPending: isDeleting, isError: deleteFailed } = useDeleteRecord(endpoint);
  const event = useRecordHighlight(id);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [tab, setTab] = React.useState<DrawerTab>('details');

  // A fresh record (new `id`) should never inherit a stale confirm dialog — or the
  // Related tab — from whatever was previously open in the drawer.
  React.useEffect(() => {
    setConfirmOpen(false);
    setTab('details');
  }, [id]);

  const isLoading = query.isLoading;
  const data = (query.data ?? {}) as RowData & { events?: EventRow[] };

  // Round 10: the ref names the coffee; a row whose ref has gone out more than once shows
  // its place in the sequence and, on Related, the other sends. Only the sample books have
  // lots/loop-ins (the drawer is shared with nothing else today, but stay explicit).
  const isSample = endpoint.endsWith('-samples');
  const ref = str(data.ref) ?? str(data.sample_ref);
  const lotSends = typeof data.lot_sends === 'number' ? data.lot_sends : 0;
  const lot = useLotSends(isSample && lotSends > 1 ? ref : null);
  // Never surface the raw UUID as the title — the identifying field differs per book
  // (specialty: ref/name, bulk: sample_ref/quality, forwarding: sample_ref/id_number,
  // clients: name), so walk the candidates in priority order and fall back to the
  // tab's entity label.
  const title =
    [data.ref, data.sample_ref, data.name, data.id_number, data.quality, data.coffee_quality].find(
      (v): v is string => typeof v === 'string' && v.trim() !== '',
    ) ??
    entityLabel ??
    'Record';

  function commitEdit(field: string, value: string | number) {
    patchRecord({ id, body: { [field]: value } });
  }

  function confirmDelete() {
    deleteRecord(id, {
      onSuccess: () => {
        setConfirmOpen(false);
        onClose();
      },
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[480px]">
        {/* Radix already handles the panel's own enter/exit via Sheet's CSS animation
            (Task 2); this motion.div layers a restrained ~180ms content fade/slide on
            top so the drawer's content feels intentional rather than snapping in. */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={DETAIL_SLIDE_TRANSITION}
          className="flex h-full min-h-0 flex-col"
        >
          <SheetHeader className="shrink-0 border-b border-border px-5 py-4">
            <div className="flex items-center justify-between gap-2 pr-6">
              {isLoading ? (
                <Skeleton className="h-5 w-32" />
              ) : (
                <SheetTitle className="text-base">{title}</SheetTitle>
              )}
              {!isLoading && (
                <div className="flex shrink-0 items-center gap-1">
                  {/* Feedback ⑫: physical label for the sample bag. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    aria-label={`Print label for ${title}`}
                    onClick={() => openPrintLabel(sampleLabelData(data))}
                  >
                    <IconPrinter className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Delete ${title}`}
                    onClick={() => setConfirmOpen(true)}
                  >
                    <IconTrash className="size-4" />
                  </Button>
                </div>
              )}
            </div>
          </SheetHeader>

          {!isLoading && typeof data.deleted_at === 'string' && data.deleted_at !== '' && (
            <div className="px-5 pt-3">
              <RemovedBanner deletedAt={data.deleted_at} />
            </div>
          )}

          {event && (
            <div className="px-5 pt-3">
              <HighlightBanner event={event} />
            </div>
          )}

          {!isLoading && data.client_address_missing === true && (
            <div className="px-5 pt-3">
              <AddressGapBanner row={data} />
            </div>
          )}

          {!isLoading && isSample && lotSends > 1 && (
            <div className="px-5 pt-3">
              <ResendBanner n={sendOrdinal(id, lotSends, lot.data?.sends)} onSeeAll={() => setTab('related')} />
            </div>
          )}

          <Tabs value={tab} onValueChange={(v) => setTab(v as DrawerTab)} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-5 mt-3 w-fit">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="related">Related</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="min-h-0 flex-1 overflow-auto px-5 pb-5">
              {isLoading ? (
                <DetailsSkeleton />
              ) : (
                <dl className="flex flex-col gap-4 pt-2">
                  {fields.filter((field) => !field.hidden?.(data)).map((field) => (
                    <div key={field.key} className="flex flex-col gap-1">
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {field.label}
                      </dt>
                      <dd className="text-sm text-foreground">
                        {field.edit ? (
                          <InlineEditField editDef={field.edit} row={data} onCommit={commitEdit} />
                        ) : field.render ? (
                          field.render(data)
                        ) : (
                          displayValue(data[field.key])
                        )}
                      </dd>
                    </div>
                  ))}
                  {isSample && <LoopInSection row={data} onCommit={(ids) => patchRecord({ id, body: { notify_trader_ids: ids } })} />}
                </dl>
              )}
            </TabsContent>

            <TabsContent value="timeline" className="min-h-0 flex-1 overflow-auto px-5 pb-5">
              {isLoading ? (
                <div className="flex flex-col gap-4 pt-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <div className="pt-2">
                  <Timeline events={data.events ?? []} />
                </div>
              )}
            </TabsContent>

            <TabsContent value="related" className="min-h-0 flex-1 overflow-auto px-5 pb-5">
              {isLoading ? (
                <DetailsSkeleton />
              ) : (
                <RelatedTab row={data} id={id} lotRef={ref} lotSends={lotSends} sends={lot.data?.sends} sendsLoading={lot.isLoading} sendsError={lot.isError} />
              )}
            </TabsContent>
          </Tabs>
        </motion.div>
      </SheetContent>

      {/* Nested inside the Sheet's own Dialog-based root — Radix supports nested
          dialogs, and there's no separate alert-dialog primitive in this app, so the
          delete confirm reuses ui/dialog per the design spec. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {title}?</DialogTitle>
            <DialogDescription>
              This removes the record from the list. It can&rsquo;t be undone from the dashboard.
              The Quality team is notified of deletions.
            </DialogDescription>
          </DialogHeader>
          {deleteFailed && <p className="text-sm text-destructive">Failed to delete. Please try again.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={confirmDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}
