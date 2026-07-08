import { IconUserOff } from '@tabler/icons-react';

import { cn } from '@/lib/cn';
import type { AccountOwner } from './client-types';

/** "Jane Doe" -> "JD"; single word -> first two letters. No avatar lib — just a styled div. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/** Header identity chip for a client's account owner. Renders a deliberate "Unassigned"
 * empty state (dashed ring + muted copy) rather than leaving a blank gap when nobody
 * is assigned yet. */
export function ClientOwnerChip({ owner, className }: { owner: AccountOwner; className?: string }) {
  if (!owner) {
    return (
      <span className={cn('inline-flex items-center gap-2', className)}>
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground"
          aria-hidden="true"
        >
          <IconUserOff className="size-3.5" />
        </span>
        <span className="text-sm text-muted-foreground">Unassigned — no account owner</span>
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary"
        aria-hidden="true"
      >
        {initials(owner.name)}
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-medium text-foreground">{owner.name}</span>
        {owner.role && <span className="text-xs text-muted-foreground">{owner.role}</span>}
      </span>
    </span>
  );
}
