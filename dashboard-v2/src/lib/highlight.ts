import * as React from 'react';
import { useMatch, useSearchParams } from 'react-router-dom';

/**
 * "Just changed" landing highlight for agent deep-links.
 *
 * When the Sucafina agent writes a record it replies with a link like
 * `/samples/<id>?hl=created` or `/bulk/<id>?hl=updated`. These hooks read that
 * `?hl=` marker to (a) flash the row in the list and (b) show a banner on the
 * opened record — see HighlightBanner, RecordTable, DetailDrawer, ClientDetailPage.
 */
export type HighlightEvent = 'created' | 'updated';

function asEvent(value: string | null): HighlightEvent | null {
  return value === 'created' || value === 'updated' ? value : null;
}

/**
 * List side: the record id (if any) that should flash once in the table.
 *
 * Derives the opened id from the nested `:id` route under `basePath`
 * (e.g. '/samples') and CAPTURES it once, so the flash survives the drawer
 * stripping `?hl` from the URL a beat later (the drawer's effect runs before this
 * parent list's — capture-once defuses that ordering race). Returns undefined
 * when there is no fresh highlight.
 */
export function useRowHighlight(basePath: string): string | undefined {
  const [sp] = useSearchParams();
  const match = useMatch(`${basePath}/:id`);
  const hl = asEvent(sp.get('hl'));
  const id = match?.params.id;
  const [captured, setCaptured] = React.useState<string>();

  React.useEffect(() => {
    if (hl && id) setCaptured(id);
  }, [hl, id]);

  return captured;
}

/**
 * Record side: the banner event for the currently-open record, or null.
 *
 * Keyed on `recordId` only so it (a) resets when a drawer is reused for a
 * different record and (b) survives its own URL strip. On first sight of a valid
 * `?hl=`, it captures the event then removes `hl` from the URL (replace) so a
 * refresh or re-shared link won't re-fire the banner.
 */
export function useRecordHighlight(recordId: string): HighlightEvent | null {
  const [sp, setSp] = useSearchParams();
  const [event, setEvent] = React.useState<HighlightEvent | null>(null);

  React.useEffect(() => {
    const hl = asEvent(sp.get('hl'));
    if (hl) {
      setEvent(hl);
      const next = new URLSearchParams(sp);
      next.delete('hl');
      setSp(next, { replace: true });
    } else {
      setEvent(null);
    }
    // Intentionally keyed on recordId only. Adding `sp` would re-run this after
    // we strip `hl` and immediately null the banner; `recordId` changing is the
    // real signal that a different record is being shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId]);

  return event;
}
