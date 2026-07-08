import { cn } from '@/lib/cn';
import { tagColor, type TagKind } from '@/lib/tags';

export function StatusBadge({ kind, value }: { kind: TagKind; value: string | null }) {
  if (!value) return <span className="inline-flex items-center text-xs text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        // Twenty's tag pills: fully rounded, a small color dot ahead of the
        // humanized label (color is never the only signal — the label is
        // always rendered too, per src/lib/tags.ts's contrast notes).
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none',
        tagColor(kind, value),
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden="true" />
      {value.replace(/_/g, ' ')}
    </span>
  );
}
