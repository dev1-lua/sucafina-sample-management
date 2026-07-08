import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { IconArrowLeft, IconPencil, IconTrash } from '@tabler/icons-react';

import { useRecord, usePatchRecord, useTraders } from '@/lib/query';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Timeline } from '@/components/Timeline';
import { ClientFormDialog } from '@/components/ClientFormDialog';
import { ClientDeleteDialog } from '@/components/client-delete-dialog';
import { ClientOwnerChip } from '@/components/client-owner-chip';
import { ClientOrdersTable } from '@/components/client-orders-table';
import type { ClientContact, ClientDetail } from '@/components/client-types';

// Sentinel Select value for "no owner" — Radix Select can't carry an empty-string item value.
const UNASSIGNED = '__unassigned__';

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-48 rounded-lg lg:col-span-1" />
        <Skeleton className="h-48 rounded-lg lg:col-span-2" />
      </div>
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  );
}

function ContactCard({ contact }: { contact: ClientContact }) {
  const hasDetails = contact.full_address || contact.phone || contact.email;
  return (
    <div className="rounded-[4px] border border-border p-3">
      <p className="text-sm font-medium text-foreground">{contact.attention_to || 'Unnamed contact'}</p>
      {contact.full_address && <p className="mt-1 text-xs text-muted-foreground">{contact.full_address}</p>}
      {(contact.phone || contact.email) && (
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {contact.phone && <span>{contact.phone}</span>}
          {contact.email && <span>{contact.email}</span>}
        </div>
      )}
      {!hasDetails && <p className="mt-1 text-xs text-muted-foreground">No phone, email, or address on file.</p>}
    </div>
  );
}

export default function ClientDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useRecord('/clients', id);
  const traders = useTraders();
  const { mutate: patchOwner, isPending: ownerPending } = usePatchRecord('/clients');

  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [ownerError, setOwnerError] = React.useState<string | null>(null);

  if (query.isLoading) return <DetailSkeleton />;

  if (query.isError || !query.data) {
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <Link
          to="/clients"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <IconArrowLeft className="size-3.5" /> Back to clients
        </Link>
        <p className="text-sm text-muted-foreground">This client could not be found.</p>
      </div>
    );
  }

  // `useRecord`'s generic Detail type is a loose `Record<string, unknown>` shared across every
  // tab's DetailDrawer; narrow it here to the client-specific shape this page actually renders.
  const data = query.data as unknown as ClientDetail;
  const ownerValue = data.account_owner_id ?? UNASSIGNED;

  function handleOwnerChange(next: string) {
    setOwnerError(null);
    patchOwner(
      { id, body: { account_owner_id: next === UNASSIGNED ? null : next } },
      { onError: () => setOwnerError('Failed to update account owner.') },
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <Link
        to="/clients"
        className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <IconArrowLeft className="size-3.5" /> Back to clients
      </Link>

      {/* Header: identity + account-owner chip + primary actions */}
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{data.name}</h1>
            <p className="text-sm text-muted-foreground">{data.country || 'No country on file'}</p>
          </div>
          <ClientOwnerChip owner={data.account_owner} />
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <IconPencil className="size-3.5" /> Edit
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
            <IconTrash className="size-3.5" /> Delete
          </Button>
        </div>
      </div>

      {/* Assign/reassign account owner */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Account owner</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Assign the trader responsible for this client relationship.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Select value={ownerValue} onValueChange={handleOwnerChange}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              {(traders.data ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.role ? `${t.name} — ${t.role}` : t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {ownerPending && <span className="text-xs text-muted-foreground">Saving…</span>}
          {ownerError && <span className="text-xs text-destructive">{ownerError}</span>}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Contacts */}
        <section className="rounded-lg border border-border bg-card p-4 lg:col-span-1">
          <h2 className="text-sm font-medium text-foreground">Contacts</h2>
          {data.contacts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No contacts on file.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {data.contacts.map((c) => (
                <ContactCard key={c.id} contact={c} />
              ))}
            </div>
          )}
        </section>

        {/* Cross-table orders (specialty/bulk/forwarding) */}
        <section className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
          <h2 className="text-sm font-medium text-foreground">Orders</h2>
          <div className="mt-3">
            <ClientOrdersTable orders={data.orders} />
          </div>
        </section>
      </div>

      {/* Timeline */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium text-foreground">Timeline</h2>
        <div className="mt-3">
          <Timeline events={data.events ?? []} />
        </div>
      </section>

      <ClientFormDialog
        mode="edit"
        open={editOpen}
        onOpenChange={setEditOpen}
        client={{ id: data.id, name: data.name, country: data.country }}
      />
      <ClientDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        clientId={data.id}
        clientName={data.name}
        onDeleted={() => navigate('/clients')}
      />
    </div>
  );
}
