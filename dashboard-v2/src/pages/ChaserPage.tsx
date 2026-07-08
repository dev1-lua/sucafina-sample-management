import { Link } from 'react-router-dom';
import {
  IconAlarm,
  IconTruckDelivery,
  IconClipboardList,
  IconRefresh,
  IconCircleCheck,
} from '@tabler/icons-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useDigest, useRunChaser } from '@/lib/query';
import { TAB_REGISTRY } from '@/tabs/registry';
import type { DigestBucket, DigestBucketKey, DigestItem, TabKey } from '@/types';

// Bucket order + copy (mirrors v1's ChaserPage) with a v2 icon per bucket.
const BUCKETS: { key: DigestBucketKey; title: string; icon: typeof IconAlarm; tint: string }[] = [
  { key: 'not_dispatched', title: 'Not yet dispatched (past due)', icon: IconAlarm, tint: 'text-rose-500 dark:text-rose-400' },
  { key: 'no_delivery_confirmation', title: 'Dispatched, no delivery confirmation (>5 days)', icon: IconTruckDelivery, tint: 'text-amber-500 dark:text-amber-400' },
  { key: 'awaiting_results', title: 'Delivered, awaiting results (>7 days)', icon: IconClipboardList, tint: 'text-blue-500 dark:text-blue-400' },
];

const fmtDate = (d?: string | null) => (d ? String(d).slice(0, 10) : '—');

/** Link a digest row's ref to its drawer route (/samples|/bulk|/forwarding/:id),
 * falling back to plain text if the tab has no list route. */
function RefCell({ item }: { item: DigestItem }) {
  const label = item.ref ?? '—';
  const cfg = TAB_REGISTRY[item.tab as TabKey];
  if (!cfg) return <span>{label}</span>;
  return (
    <Link to={`${cfg.path}/${item.id}`} className="font-medium text-primary hover:underline">
      {label}
    </Link>
  );
}

function BucketCard({ meta, bucket }: { meta: (typeof BUCKETS)[number]; bucket: DigestBucket }) {
  const Icon = meta.icon;
  const empty = bucket.count === 0;
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Icon className={`size-4 shrink-0 ${meta.tint}`} />
        <h3 className="flex-1 text-sm font-semibold">{meta.title}</h3>
        <Badge variant={empty ? 'outline' : 'secondary'}>{bucket.count}</Badge>
      </div>

      {empty ? (
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
          <IconCircleCheck className="size-4 text-emerald-500" />
          Nothing here — all clear.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Tab</TableHead>
                <TableHead>Quality</TableHead>
                <TableHead>Receiver</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>AWB</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bucket.items.map((item) => (
                <TableRow key={`${item.tab}:${item.id}`}>
                  <TableCell><RefCell item={item} /></TableCell>
                  <TableCell><Badge variant="outline" className="capitalize">{item.tab}</Badge></TableCell>
                  <TableCell>{item.quality ?? '—'}</TableCell>
                  <TableCell>{item.receiver ?? '—'}</TableCell>
                  <TableCell className="tabular-nums">{fmtDate(item.date_on)}</TableCell>
                  <TableCell>{item.awb ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {bucket.count > bucket.items.length && (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              showing {bucket.items.length} of {bucket.count}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChaserPage() {
  const { data: digest, isLoading, isError } = useDigest();
  const run = useRunChaser();

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Samples needing a follow-up, grouped by what they're waiting on.
          {digest && (
            <span className="ml-1">
              Generated {digest.generated_at.slice(0, 16).replace('T', ' ')}.
            </span>
          )}
          {isError && <span className="ml-1 text-destructive">Couldn't load the digest.</span>}
        </p>
        <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
          <IconRefresh className={run.isPending ? 'animate-spin' : undefined} />
          {run.isPending ? 'Running…' : 'Run now'}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-4">
          {BUCKETS.map((b) => (
            <Skeleton key={b.key} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      ) : digest ? (
        <div className="flex flex-col gap-4">
          {BUCKETS.map((meta) => (
            <BucketCard key={meta.key} meta={meta} bucket={digest.buckets[meta.key]} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          No chaser digest yet — hit <span className="font-medium text-foreground">Run now</span> to
          generate one (it also runs automatically on weekday mornings).
        </div>
      )}
    </div>
  );
}
