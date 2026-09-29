import { cn } from '@/lib/cn';
import type { ColumnDef } from '@/types';

/**
 * Round 11: every send has its own Send ID (`SS-<n>`), unique to the row. The reference is NOT
 * that — it names the coffee and is shared by every send of it — which is what confused the
 * team. Wherever a row is shown the send id leads, in monospace so it reads as an identifier.
 */
export const SEND_ID_TITLE = 'Unique to this send. The reference names the coffee and is shared by every send of it.';

export function sendIdOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** `SS-1234` in monospace; em-dash when the row predates the column (or the API omits it). */
export function SendId({ value, className }: { value: unknown; className?: string }) {
  const id = sendIdOf(value);
  if (!id) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn('font-mono text-xs tabular-nums', className)} title={SEND_ID_TITLE}>
      {id}
    </span>
  );
}

/** First column of the three Sends tables. Narrow, monospace, not sortable (the API's sort
 * whitelist doesn't carry it) and never defaultHidden — the column menu is gone. */
export const sendIdColumn: ColumnDef = {
  key: 'send_id',
  header: 'Send ID',
  headerTitle: SEND_ID_TITLE,
  width: 90,
  render: (r) => <SendId value={r.send_id} />,
};
