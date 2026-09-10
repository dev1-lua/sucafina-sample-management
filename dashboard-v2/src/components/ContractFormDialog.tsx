import * as React from 'react';

import { useCreateRecord, usePatchRecord, useRecords } from '@/lib/query';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type ContractFormMode = 'create' | 'edit';

export type ContractDraft = {
  id: string;
  contract_number: string;
  client_id?: string | null;
  client_name?: string | null;
  quality?: string | null;
  destination?: string | null;
  shipment_date?: string | null;
  containers?: number | null;
  pss_expected?: number | null;
  po_ref?: string | null;
  pss_qty_grams?: number | null;
  notes?: string | null;
};

export type ContractFormDialogProps = {
  mode: ContractFormMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required for `mode="edit"` — seeds the form. Ignored for `mode="create"`. */
  contract?: ContractDraft | null;
  onSaved?: (record: Record<string, unknown>) => void;
};

// Radix Select can't carry an empty-string item value.
const NO_CLIENT = '__none__';

type Draft = {
  contract_number: string; client_id: string; client_name: string; quality: string;
  destination: string; shipment_date: string; containers: string; pss_expected: string;
  po_ref: string; pss_qty_grams: string; notes: string;
};

const EMPTY: Draft = {
  contract_number: '', client_id: NO_CLIENT, client_name: '', quality: '',
  destination: '', shipment_date: '', containers: '1', pss_expected: '', po_ref: '', pss_qty_grams: '', notes: '',
};

const intOr = (v: string, fallback: number | null): number | null => {
  const n = Number(v.trim());
  return v.trim() !== '' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
};

/**
 * Create/edit one contract. Create optionally draws the whole set of PSS requests up front
 * ("Draw PSS rows now" → `create_pss`), which is how a contract typed in by hand catches up with one
 * that arrived through the SOL import. Edit PATCHes the same fields; status is derived from the
 * containers' verdicts and is not editable here.
 */
export function ContractFormDialog({ mode, open, onOpenChange, contract, onSaved }: ContractFormDialogProps) {
  const isEdit = mode === 'edit';
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [createPss, setCreatePss] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const { mutate: createContract, isPending: isCreating } = useCreateRecord('/contracts');
  const { mutate: patchContract, isPending: isPatching } = usePatchRecord('/contracts');
  const isPending = isCreating || isPatching;

  // The client picker: the book, newest names first, resolved by id so the contract joins the
  // client's account manager (who gets the PSS reminders). A free-text name still works without one.
  const clients = useRecords('/clients', { sort: null, filters: {}, page: 1, pageSize: 200 });
  const clientOptions = (clients.data?.data ?? []) as Array<{ id: string; name: string }>;

  React.useEffect(() => {
    if (!open) return;
    setDraft(
      isEdit && contract
        ? {
            contract_number: contract.contract_number ?? '',
            client_id: contract.client_id ?? NO_CLIENT,
            client_name: contract.client_name ?? '',
            quality: contract.quality ?? '',
            destination: contract.destination ?? '',
            shipment_date: (contract.shipment_date ?? '').slice(0, 10),
            containers: contract.containers != null ? String(contract.containers) : '1',
            pss_expected: contract.pss_expected != null ? String(contract.pss_expected) : '',
            po_ref: contract.po_ref ?? '',
            pss_qty_grams: contract.pss_qty_grams != null ? String(contract.pss_qty_grams) : '',
            notes: contract.notes ?? '',
          }
        : EMPTY,
    );
    setCreatePss(false);
    setError(null);
  }, [open, isEdit, contract]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const number = draft.contract_number.trim();
    if (!number) {
      setError('Contract number is required.');
      return;
    }
    setError(null);
    const containers = intOr(draft.containers, 1)!;
    const body: Record<string, unknown> = {
      contract_number: number,
      client_id: draft.client_id === NO_CLIENT ? null : draft.client_id,
      client_name: draft.client_name.trim() || null,
      quality: draft.quality.trim() || null,
      destination: draft.destination.trim() || null,
      shipment_date: draft.shipment_date.trim() || null,
      containers,
      // Harriet: the number of lettered options is the client's ask, not the container count — it only
      // falls back to the containers when nobody typed it.
      pss_expected: intOr(draft.pss_expected, containers),
      po_ref: draft.po_ref.trim() || null,
      pss_qty_grams: intOr(draft.pss_qty_grams, null),
      notes: draft.notes.trim() || null,
    };

    const onError = (err: unknown) =>
      setError(
        err instanceof Error && /409/.test(err.message)
          ? `Contract ${number} already exists.`
          : `Failed to ${isEdit ? 'save changes' : 'create the contract'}. Please try again.`,
      );
    const onSuccess = (row: Record<string, unknown>) => {
      onSaved?.(row);
      onOpenChange(false);
    };

    if (isEdit) {
      if (!contract) return;
      patchContract({ id: contract.id, body }, { onSuccess, onError });
      return;
    }
    createContract({ ...body, create_pss: createPss }, { onSuccess, onError });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit contract' : 'New contract'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update this contract. PSS status follows the options’ verdicts and is not set by hand.'
              : 'PSS are due 45 days before the shipment date — set that date and the deadline follows.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="contract-number" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Contract #
            </label>
            <Input
              id="contract-number"
              autoFocus
              value={draft.contract_number}
              onChange={(e) => set({ contract_number: e.target.value })}
              placeholder="CT-2026-14"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Client</label>
            <Select value={draft.client_id} onValueChange={(v) => set({ client_id: v })}>
              <SelectTrigger aria-label="Client">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLIENT}>Not in the book — type a name</SelectItem>
                {clientOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draft.client_id === NO_CLIENT && (
              <Input
                aria-label="Client name"
                value={draft.client_name}
                onChange={(e) => set({ client_name: e.target.value })}
                placeholder="Paulig"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="contract-quality" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Quality
              </label>
              <Input id="contract-quality" value={draft.quality} onChange={(e) => set({ quality: e.target.value })} placeholder="AB FAQ" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="contract-destination" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Destination
              </label>
              <Input id="contract-destination" value={draft.destination} onChange={(e) => set({ destination: e.target.value })} placeholder="Finland" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="contract-shipment" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Shipment date
              </label>
              <Input id="contract-shipment" type="date" value={draft.shipment_date} onChange={(e) => set({ shipment_date: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="contract-containers" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Containers
              </label>
              <Input id="contract-containers" type="number" min={1} max={50} value={draft.containers} onChange={(e) => set({ containers: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="contract-pss" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                PSS options
              </label>
              <Input
                id="contract-pss"
                type="number"
                min={1}
                max={50}
                value={draft.pss_expected}
                onChange={(e) => set({ pss_expected: e.target.value })}
                placeholder={draft.containers || '1'}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="contract-po" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                PO ref
              </label>
              <Input id="contract-po" value={draft.po_ref} onChange={(e) => set({ po_ref: e.target.value })} placeholder="Client's PO number" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="contract-qty" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Grams per option
              </label>
              <Input
                id="contract-qty"
                type="number"
                min={1}
                max={50000}
                value={draft.pss_qty_grams}
                onChange={(e) => set({ pss_qty_grams: e.target.value })}
                placeholder="client's usual"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="contract-notes" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Notes
            </label>
            <Input id="contract-notes" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>

          {!isEdit && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={createPss} onChange={(e) => setCreatePss(e.target.checked)} className="size-3.5" />
              Draw PSS rows now
            </label>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create contract'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
