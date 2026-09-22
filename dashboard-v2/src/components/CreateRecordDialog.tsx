import * as React from 'react';
import { IconPlus, IconX } from '@tabler/icons-react';

import {
  useCreateRecord,
  useCreateConsignment,
  resolveLot,
  parseRefConflict,
  type Lot,
  type LotBook,
  type LotResolveRequest,
  type LotResolveResult,
} from '@/lib/query';
import { cn } from '@/lib/cn';
import type { CreateFieldDef } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EditableSelect } from '@/components/EditableSelect';

export type CreateRecordDialogProps = {
  endpoint: string;
  entityLabel: string;
  fields: CreateFieldDef[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set for the Specialty / Commercial books: turns on the lot-resolve notice and the
   * "another coffee for this client" repeater (round 10). Forwarding has no lots. */
  book?: LotBook;
};

type FormValues = Record<string, string>;
type Row = { id: number; values: FormValues };
type Created = { tab: string; id: string; client_id: string | null };

/** How many coffees one request may carry (rows in the repeater, incl. the first). */
export const MAX_COFFEES = 10;

// Which POST fields describe the coffee (blur → POST /lots/resolve), which one is the typed
// ref, and how the lot's coffee reads in a notice — per book (contracts §1 vocabulary).
type BookSpec = {
  refKey: string;
  coffeeKeys: string[];
  sampleTypeKey: string;
  toResolve: (v: FormValues) => Omit<LotResolveRequest, 'book' | 'ref' | 'sample_type'>;
  coffeeLabel: (lot: Lot) => string;
};
const BOOK_SPEC: Record<LotBook, BookSpec> = {
  specialty: {
    refKey: 'ref',
    coffeeKeys: ['outturn', 'grade', 'description'],
    sampleTypeKey: 'sample_type_norm',
    toResolve: (v) => ({ outturn: v.outturn || null, grade: v.grade || null, quality: v.description || null, blend: null }),
    coffeeLabel: (lot) => [lot.outturn, lot.grade].filter(Boolean).join(' · ') || lot.quality || lot.ref,
  },
  commercial: {
    refKey: 'sample_ref',
    coffeeKeys: ['quality', 'blend'],
    sampleTypeKey: 'sample_type',
    toResolve: (v) => ({ outturn: null, grade: null, quality: v.quality || null, blend: v.blend || null }),
    coffeeLabel: (lot) => [lot.quality, lot.blend].filter(Boolean).join(' · ') || lot.ref,
  },
};

// Request-level fields: typed once and shared by every coffee in the request. Everything
// else (the coffee, its ref, quantities, lot details, comments…) is per coffee. There is no
// address field on the create form — the address lives on the client record.
const SHARED_KEYS = new Set([
  'receiver_company', 'client', 'country', 'awb', 'courier_norm', 'location', 'phyto_cert',
  'priority', 'requested_by', 'logged_by',
]);

function initialValues(fields: CreateFieldDef[]): FormValues {
  return Object.fromEntries(
    fields.map((f) => [f.key, f.defaultValue !== undefined ? String(f.defaultValue) : '']),
  );
}

/** '/specialty-samples' → 'specialty', '/bulk-samples' → 'bulk' (the {tab,id} pair an order takes). */
function tabOf(endpoint: string): string {
  return endpoint.replace(/^\//, '').replace(/-samples$/, '');
}

function noticeText(spec: BookSpec, r: LotResolveResult): string | null {
  if (r.action === 'reuse' && r.ref) {
    const n = r.sends.length;
    return `Same coffee as ${r.ref} (${n} send${n === 1 ? '' : 's'}) — the ref will be reused`;
  }
  if (r.action === 'conflict' && r.ref && r.lot) {
    return `${r.ref} already names ${spec.coffeeLabel(r.lot)} — a new ref will be issued`;
  }
  return null;
}

/** One form control, driven by a CreateFieldDef. `onBlur`/select-commit let the caller resolve the lot. */
function FieldInput({
  f, id, value, onChange, onBlur,
}: {
  f: CreateFieldDef; id: string; value: string; onChange: (v: string) => void; onBlur?: () => void;
}) {
  if (f.type === 'select' && f.allowCustom) {
    return (
      <EditableSelect
        id={id}
        value={value}
        options={f.options ?? []}
        humanize
        placeholder={f.placeholder ?? 'Select…'}
        onCommit={(v) => onChange(v)}
      />
    );
  }
  if (f.type === 'select') {
    return (
      <Select value={value || undefined} onValueChange={(v) => onChange(v)}>
        <SelectTrigger id={id} className="h-8 text-sm">
          <SelectValue placeholder={f.placeholder ?? 'Select…'} />
        </SelectTrigger>
        <SelectContent>
          {(f.options ?? []).map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt.replace(/_/g, ' ')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      id={id}
      type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={f.placeholder}
      required={f.required}
      className="h-8 text-sm"
    />
  );
}

/** Center modal create form, driven entirely by a tab's `createFields` (sourced from the
 * API's exact POST body zod schema — see each tabs/*.tsx config for provenance notes).
 * Server issues the ref/id; on success the list re-fetches via useCreateRecord's
 * invalidation and the dialog closes — no local optimistic row insertion needed.
 *
 * Round 10, Specialty/Commercial only: a ref names the coffee, so leaving the coffee fields
 * (or a typed ref) asks POST /lots/resolve and shows what the save will do — reuse the
 * coffee's ref, or issue a new one because the typed ref already names another coffee (that
 * ref is then dropped from the save). A 409 `ref_conflict` on save shows the same notice
 * and retries without the ref only once the user confirms. "Add another coffee for this
 * client" repeats the per-coffee fields (max 10) under the shared request fields; with
 * "Group as one order" on, the created rows are attached to one new consignment. */
export function CreateRecordDialog({ endpoint, entityLabel, fields, open, onOpenChange, book }: CreateRecordDialogProps) {
  const { mutateAsync: createRecord, reset } = useCreateRecord(endpoint);
  const { mutateAsync: createOrder } = useCreateConsignment();
  const spec = book ? BOOK_SPEC[book] : null;

  const perCoffeeFields = React.useMemo(() => fields.filter((f) => !SHARED_KEYS.has(f.key)), [fields]);
  const nextRowId = React.useRef(1);
  const newRow = React.useCallback(
    (): Row => ({ id: nextRowId.current++, values: initialValues(perCoffeeFields) }),
    [perCoffeeFields],
  );

  const [rows, setRows] = React.useState<Row[]>(() => [{ id: 0, values: initialValues(fields) }]);
  const [groupAsOrder, setGroupAsOrder] = React.useState(true);
  const [notices, setNotices] = React.useState<Record<number, LotResolveResult>>({});
  // The row whose save came back 409 — the footer button turns into the confirmation.
  const [pendingConflict, setPendingConflict] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  // Rows already created in this attempt: a 409 on row 3 must not re-create rows 1–2 on retry.
  const created = React.useRef<Record<number, Created>>({});
  // Per-row resolve sequence, so a slow earlier answer never overwrites a newer one.
  const resolveSeq = React.useRef<Record<number, number>>({});

  // Fresh form + cleared mutation error every time the dialog is (re)opened.
  React.useEffect(() => {
    if (open) {
      setRows([{ id: 0, values: initialValues(fields) }]);
      setGroupAsOrder(true);
      setNotices({});
      setPendingConflict(null);
      setSubmitError(null);
      setBusy(false);
      created.current = {};
      resolveSeq.current = {};
      reset();
    }
  }, [open, fields, reset]);

  /** The row's full field view: shared values come from the first row. */
  const effectiveValues = React.useCallback(
    (row: Row): FormValues => {
      const first = rows[0]?.values ?? {};
      const out: FormValues = {};
      for (const f of fields) out[f.key] = (SHARED_KEYS.has(f.key) ? first[f.key] : row.values[f.key]) ?? '';
      return out;
    },
    [rows, fields],
  );

  function setField(rowId: number, key: string, value: string) {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, [key]: value } } : r)));
    if (spec && (key === spec.refKey || spec.coffeeKeys.includes(key))) {
      // The notice described the previous input; it comes back on the next blur.
      setNotices((prev) => {
        if (!(rowId in prev)) return prev;
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
      if (pendingConflict === rowId) setPendingConflict(null);
    }
  }

  async function resolveRow(rowId: number, values: FormValues) {
    if (!spec || !book) return;
    const ref = values[spec.refKey]?.trim() || null;
    const coffee = spec.toResolve(values);
    const hasCoffee = !!(coffee.outturn || coffee.quality);
    if (!ref && !hasCoffee) return;
    const seq = (resolveSeq.current[rowId] ?? 0) + 1;
    resolveSeq.current[rowId] = seq;
    try {
      const result = await resolveLot({ book, ref, ...coffee, sample_type: values[spec.sampleTypeKey]?.trim() || null });
      if (resolveSeq.current[rowId] !== seq) return;
      setNotices((prev) => ({ ...prev, [rowId]: result }));
    } catch {
      // Advisory only — the save reports a real conflict itself (409).
    }
  }

  function isCoffeeKey(key: string): boolean {
    return !!spec && (key === spec.refKey || spec.coffeeKeys.includes(key) || key === spec.sampleTypeKey);
  }

  function bodyFor(row: Row): Record<string, unknown> {
    const values = effectiveValues(row);
    const dropRef = !!spec && notices[row.id]?.action === 'conflict';
    const body: Record<string, unknown> = {};
    for (const f of fields) {
      if (dropRef && f.key === spec!.refKey) continue;
      const raw = values[f.key];
      if (raw === undefined || raw === '') continue; // let the API apply its own nullish/default handling
      body[f.key] = f.type === 'number' ? Number(raw) : raw;
    }
    return body;
  }

  async function submitAll() {
    setSubmitError(null);
    setPendingConflict(null);
    setBusy(true);
    const tab = tabOf(endpoint);
    try {
      for (const row of rows) {
        if (created.current[row.id]) continue;
        try {
          const res = await createRecord(bodyFor(row));
          created.current[row.id] = {
            tab,
            id: String(res.id),
            client_id: typeof res.client_id === 'string' ? res.client_id : null,
          };
        } catch (err) {
          const conflict = parseRefConflict(err);
          if (conflict) {
            setNotices((prev) => ({ ...prev, [row.id]: conflict }));
            setPendingConflict(row.id);
            return;
          }
          throw err;
        }
      }
      if (spec && groupAsOrder && rows.length >= 2) {
        const made = rows.map((r) => created.current[r.id]).filter((m): m is Created => !!m);
        const clientId = made.find((m) => m.client_id)?.client_id ?? null;
        const first = rows[0]?.values ?? {};
        await createOrder({
          ...(clientId ? { client_id: clientId } : {}),
          ...(first.requested_by ? { requested_by: first.requested_by } : {}),
          ...(first.logged_by ? { logged_by: first.logged_by } : {}),
          samples: made.map(({ tab: t, id }) => ({ tab: t, id })),
        });
      }
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create record.');
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitAll();
  }

  function addRow() {
    setRows((prev) => (prev.length >= MAX_COFFEES ? prev : [...prev, newRow()]));
  }

  function removeRow(rowId: number) {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    setNotices((prev) => {
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
    delete created.current[rowId];
    if (pendingConflict === rowId) setPendingConflict(null);
  }

  function renderField(row: Row, f: CreateFieldDef) {
    const inputId = `create-${endpoint}-${row.id}-${f.key}`;
    const value = row.values[f.key] ?? '';
    const coffeeKey = isCoffeeKey(f.key);
    return (
      <div key={f.key} className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {f.label}
          {f.required && <span className="text-destructive"> *</span>}
        </label>
        <FieldInput
          f={f}
          id={inputId}
          value={value}
          onChange={(v) => {
            setField(row.id, f.key, v);
            // Selects have no blur to hook: a committed sample type re-resolves right away.
            if (coffeeKey && f.type === 'select') void resolveRow(row.id, { ...effectiveValues(row), [f.key]: v });
          }}
          onBlur={coffeeKey ? () => void resolveRow(row.id, effectiveValues(row)) : undefined}
        />
      </div>
    );
  }

  function renderNotice(row: Row) {
    const r = spec ? notices[row.id] : undefined;
    const text = r && spec ? noticeText(spec, r) : null;
    if (!text) return null;
    return (
      <p
        role="status"
        className={cn(
          'rounded-[4px] px-2.5 py-1.5 text-xs',
          r!.action === 'conflict'
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
            : 'bg-muted text-muted-foreground',
        )}
      >
        {text}
      </p>
    );
  }

  const first = rows[0]!;
  const extra = rows.slice(1);
  const n = rows.length;
  const submitLabel = busy
    ? 'Creating…'
    : pendingConflict !== null
      ? 'Create with a new ref'
      : n > 1
        ? `Create ${n} samples`
        : 'Create';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New {entityLabel}</DialogTitle>
          <DialogDescription>Fields left blank use the table&rsquo;s defaults.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {fields.map((f) => renderField(first, f))}
          {renderNotice(first)}

          {spec && (
            <div className="flex flex-col gap-3">
              {extra.map((row, i) => (
                <fieldset
                  key={row.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3"
                >
                  <legend className="px-1 text-xs font-medium text-foreground">Coffee {i + 2}</legend>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Same client, receiver and country as above.</span>
                    <button
                      type="button"
                      aria-label={`Remove coffee ${i + 2}`}
                      onClick={() => removeRow(row.id)}
                      className="rounded-[4px] text-muted-foreground transition-colors duration-150 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <IconX className="size-4" />
                    </button>
                  </div>
                  {perCoffeeFields.map((f) => renderField(row, f))}
                  {renderNotice(row)}
                </fieldset>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={busy || n >= MAX_COFFEES}>
                  <IconPlus className="size-3.5" /> Add another coffee for this client
                </Button>
                {n >= 2 && (
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={groupAsOrder}
                      onChange={(e) => setGroupAsOrder(e.target.checked)}
                      className="size-3.5"
                    />
                    Group as one order
                  </label>
                )}
              </div>
            </div>
          )}

          {submitError && <p className="text-sm text-destructive">{submitError}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
