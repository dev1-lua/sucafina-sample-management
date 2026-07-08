import * as React from 'react';

import { useCreateRecord, usePatchRecord } from '@/lib/query';
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

export type ClientFormMode = 'create' | 'edit';

export type ClientFormDialogProps = {
  mode: ClientFormMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required for `mode="edit"` — seeds the form. Ignored for `mode="create"`. */
  client?: { id: string; name: string; country?: string | null } | null;
  onSaved?: (record: Record<string, unknown>) => void;
};

type ContactDraft = { attention_to: string; full_address: string; phone: string; email: string };

const EMPTY_CONTACT: ContactDraft = { attention_to: '', full_address: '', phone: '', email: '' };

/** Create/edit dialog for a client. Account-owner assignment intentionally lives outside
 * this form (a dedicated always-visible control on ClientDetailPage) — this dialog only
 * covers the fields that make sense in a one-shot "create" flow (name, country, an
 * optional primary contact) plus the "edit" subset the PATCH schema supports (name,
 * country). */
export function ClientFormDialog({ mode, open, onOpenChange, client, onSaved }: ClientFormDialogProps) {
  const isEdit = mode === 'edit';
  const [name, setName] = React.useState('');
  const [country, setCountry] = React.useState('');
  const [contact, setContact] = React.useState<ContactDraft>(EMPTY_CONTACT);
  const [showContact, setShowContact] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const { mutate: createClient, isPending: isCreating } = useCreateRecord('/clients');
  const { mutate: patchClient, isPending: isPatching } = usePatchRecord('/clients');
  const isPending = isCreating || isPatching;

  // Reset the draft every time the dialog opens: blank for create, seeded from `client` for edit.
  React.useEffect(() => {
    if (!open) return;
    setName(isEdit ? client?.name ?? '' : '');
    setCountry(isEdit ? client?.country ?? '' : '');
    setContact(EMPTY_CONTACT);
    setShowContact(false);
    setError(null);
  }, [open, isEdit, client]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name is required.');
      return;
    }
    setError(null);

    if (isEdit) {
      if (!client) return;
      patchClient(
        { id: client.id, body: { name: trimmedName, country: country.trim() || null } },
        {
          onSuccess: (row) => {
            onSaved?.(row);
            onOpenChange(false);
          },
          onError: () => setError('Failed to save changes. Please try again.'),
        },
      );
      return;
    }

    const hasContact = Object.values(contact).some((v) => v.trim().length > 0);
    createClient(
      {
        name: trimmedName,
        country: country.trim() || null,
        contact: hasContact
          ? {
              attention_to: contact.attention_to.trim() || null,
              full_address: contact.full_address.trim() || null,
              phone: contact.phone.trim() || null,
              email: contact.email.trim() || null,
            }
          : null,
      },
      {
        onSuccess: (row) => {
          onSaved?.(row);
          onOpenChange(false);
        },
        onError: () => setError('Failed to create client. Please try again.'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit client' : 'New client'}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this client's name and country." : 'Add a new client to the roster.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="client-name" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Name
            </label>
            <Input
              id="client-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Coffee Co."
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="client-country"
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              Country
            </label>
            <Input
              id="client-country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Ethiopia"
            />
          </div>

          {!isEdit && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowContact((v) => !v)}
                className="self-start text-xs font-medium text-primary hover:underline"
              >
                {showContact ? 'Remove primary contact' : '+ Add a primary contact'}
              </button>
              {showContact && (
                <div className="flex flex-col gap-2 rounded-[4px] border border-border p-3">
                  <Input
                    aria-label="Attention to"
                    placeholder="Attention to"
                    value={contact.attention_to}
                    onChange={(e) => setContact((c) => ({ ...c, attention_to: e.target.value }))}
                  />
                  <Input
                    aria-label="Address"
                    placeholder="Address"
                    value={contact.full_address}
                    onChange={(e) => setContact((c) => ({ ...c, full_address: e.target.value }))}
                  />
                  <Input
                    aria-label="Phone"
                    placeholder="Phone"
                    value={contact.phone}
                    onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))}
                  />
                  <Input
                    aria-label="Email"
                    placeholder="Email"
                    value={contact.email}
                    onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
                  />
                </div>
              )}
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
