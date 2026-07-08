import { cn } from '@/lib/cn';
import { tagColor, type TagKind } from '@/lib/tags';

export function StatusBadge({ kind, value }: { kind: TagKind; value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-xs font-medium',
        tagColor(kind, value),
      )}
    >
      {value.replace(/_/g, ' ')}
    </span>
  );
}
