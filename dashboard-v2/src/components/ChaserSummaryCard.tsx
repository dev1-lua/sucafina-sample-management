import { Link } from 'react-router-dom';
import {
  IconAlarm,
  IconTruckDelivery,
  IconClipboardList,
  IconChevronRight,
} from '@tabler/icons-react';

import { Skeleton } from '@/components/ui/skeleton';
import { useDigest } from '@/lib/query';
import type { DigestBucketKey } from '@/types';

const ITEMS: { key: DigestBucketKey; label: string; icon: typeof IconAlarm; tint: string }[] = [
  { key: 'not_dispatched', label: 'Not dispatched', icon: IconAlarm, tint: 'text-rose-500 dark:text-rose-400' },
  { key: 'no_delivery_confirmation', label: 'No delivery confirm.', icon: IconTruckDelivery, tint: 'text-amber-500 dark:text-amber-400' },
  { key: 'awaiting_results', label: 'Awaiting results', icon: IconClipboardList, tint: 'text-blue-500 dark:text-blue-400' },
];

/**
 * Compact "Needs attention" card for the dashboard — the 3 chaser bucket counts
 * at a glance. The whole card links to the full Chaser tab. Kept deliberately
 * slim so it informs without crowding the dashboard.
 */
export function ChaserSummaryCard() {
  const { data: digest, isLoading } = useDigest();

  const shell =
    'group flex items-center gap-4 rounded-lg border border-border border-l-2 border-l-rose-400/70 bg-card p-4 transition-colors hover:bg-muted/40';

  if (isLoading) {
    return (
      <div className={shell}>
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  // No digest yet — a single quiet prompt rather than empty tiles.
  if (!digest) {
    return (
      <Link to="/chaser" className={shell}>
        <span className="flex-1 text-sm text-muted-foreground">
          Run the chaser to see samples needing a follow-up
        </span>
        <IconChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
    );
  }

  return (
    <Link to="/chaser" className={shell}>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Needs attention
        </span>
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-2">
        {ITEMS.map(({ key, label, icon: Icon, tint }) => (
          <div key={key} className="flex items-center gap-2">
            <Icon className={`size-4 shrink-0 ${tint}`} />
            <span className="text-lg font-semibold tabular-nums">{digest.buckets[key].count}</span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        View chaser
        <IconChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
