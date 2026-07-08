import * as React from 'react';

import { useDeleteRecord } from '@/lib/query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type ClientDeleteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  /** Called after the delete request succeeds — the page navigates back to `/clients`. */
  onDeleted: () => void;
};

/** Confirm-then-soft-delete dialog for a client. No toast lib in this app: the dialog
 * closing + the page navigating away is the success feedback; failures surface inline. */
export function ClientDeleteDialog({ open, onOpenChange, clientId, clientName, onDeleted }: ClientDeleteDialogProps) {
  const [error, setError] = React.useState<string | null>(null);
  const { mutate: deleteClient, isPending } = useDeleteRecord('/clients');

  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);

  function handleDelete() {
    setError(null);
    deleteClient(clientId, {
      onSuccess: () => {
        onOpenChange(false);
        onDeleted();
      },
      onError: () => setError('Failed to delete client. Please try again.'),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Delete {clientName}?</DialogTitle>
          <DialogDescription>
            This removes the client from active lists. Historical orders and events are kept for audit purposes.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={isPending}>
            {isPending ? 'Deleting…' : 'Delete client'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
