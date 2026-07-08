import type { EventRow } from '@/types';

export type TimelineProps = {
  events: EventRow[];
};

/** Short, glanceable timestamp: relative for anything inside the last week, an
 * absolute short date beyond that (matches the low-chrome density of the rest
 * of the shell rather than a full ISO string). */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}

export function Timeline({ events }: TimelineProps) {
  if (events.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-4">
      {events.map((event, i) => (
        <li key={event.id} className="relative flex gap-3">
          {/* dot + hairline rail: the dot sits on a vertical line that continues to
              the next entry, giving the classic "activity feed" read at a glance */}
          <div className="relative flex w-3 shrink-0 flex-col items-center">
            <span className="mt-1 size-[7px] shrink-0 rounded-full bg-primary" aria-hidden="true" />
            {i < events.length - 1 && (
              <span className="mt-1 w-px flex-1 bg-border" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-[4px] bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
                {humanize(event.type)}
              </span>
              <time className="text-xs text-muted-foreground" dateTime={event.created_at}>
                {formatTimestamp(event.created_at)}
              </time>
            </div>
            {event.note && <p className="mt-1 text-sm text-foreground">{event.note}</p>}
            <p className="mt-0.5 text-xs text-muted-foreground">{event.actor}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
