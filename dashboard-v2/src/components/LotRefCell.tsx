import { Link } from 'react-router-dom';

import { CellValue } from '@/components/CellValue';

type RowData = Record<string, unknown>;

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * Ref cell for the Sends view (round 10). A ref names the COFFEE and is reused every time
 * that coffee goes out again, so a row whose ref has been sent more than once carries a
 * `×N` pill; it deep-links to the Coffees view with this lot expanded
 * (`<book>?view=coffees&ref=`), the same link the agent uses. The pill stops propagation
 * so it never doubles as the row's own drawer click.
 */
export function LotRefCell({ row, basePath }: { row: RowData; basePath: string }) {
  const ref = text(row.ref) ?? text(row.sample_ref);
  const sends = typeof row.lot_sends === 'number' ? row.lot_sends : 0;
  if (!ref) return <CellValue value={null} />;
  if (sends <= 1) return <>{ref}</>;
  const title = `${sends} sends of this coffee`;
  return (
    <span className="inline-flex items-center gap-1.5">
      {ref}
      <Link
        to={`${basePath}?view=coffees&ref=${encodeURIComponent(ref)}`}
        title={title}
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex h-4.5 items-center rounded-full border border-border bg-muted px-1.5 text-2xs font-medium tabular-nums text-muted-foreground transition-colors duration-150 hover:border-foreground/20 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ×{sends}
      </Link>
    </span>
  );
}

/** Order column: the consignment number as a link to its page (rows carry `consignment_id`). */
export function OrderLinkCell({ row }: { row: RowData }) {
  const number = text(row.consignment_number);
  const id = text(row.consignment_id);
  if (!number) return <CellValue value={null} />;
  if (!id) return <>{number}</>;
  return (
    <Link
      to={`/consignments/${id}`}
      onClick={(e) => e.stopPropagation()}
      className="rounded-[2px] text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {number}
    </Link>
  );
}
