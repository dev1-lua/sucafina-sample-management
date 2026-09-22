import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { IconPlus } from '@tabler/icons-react';

import { FilterBar } from '@/components/FilterBar';
import { RecordTable } from '@/components/RecordTable';
import { LotsTable } from '@/components/LotsTable';
import { useColumnVisibility } from '@/components/ColumnMenu';
import { CreateRecordDialog } from '@/components/CreateRecordDialog';
import { Button } from '@/components/ui/button';
import ConsignmentsPage from '@/pages/ConsignmentsPage';
import { TAB_REGISTRY } from '@/tabs/registry';
import { useRowHighlight } from '@/lib/highlight';
import { asListView, readListUrl, writeListUrl } from '@/lib/params';
import { cn } from '@/lib/cn';
import type { LotBook } from '@/lib/query';
import type { FilterDef, FilterState, ListView, TabKey } from '@/types';

const VIEWS: ReadonlyArray<{ key: ListView; label: string }> = [
  { key: 'sends', label: 'Sends' },
  { key: 'coffees', label: 'Coffees' },
  { key: 'orders', label: 'Orders' },
];
// Which lot book a tab is (the Forwarding book has no lots and no view switch).
const BOOK_OF: Partial<Record<TabKey, LotBook>> = { specialty: 'specialty', bulk: 'commercial' };
// The Coffees view takes free text (the search box → `q`) and the Ref deep-link chip only.
const COFFEE_FILTERS: FilterDef[] = [{ key: 'ref', label: 'Ref', type: 'text' }];
const URL_KEYS = ['ref', 'consignment'] as const;

function readStoredView(key: string): ListView | null {
  try {
    return asListView(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

/** Sends · Coffees · Orders. Buttons, not tabs: the tab strip above already owns the book
 * switch, and a pressed-state group reads right with screen readers. Wraps at phone width. */
function ViewSwitch({ value, onChange }: { value: ListView; onChange: (next: ListView) => void }) {
  return (
    <div role="group" aria-label="View" className="inline-flex flex-wrap gap-0.5 rounded-[4px] bg-muted p-0.5">
      {VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          aria-pressed={value === v.key}
          onClick={() => onChange(v.key)}
          className={cn(
            'rounded-[4px] px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === v.key && 'bg-card text-foreground shadow-sm',
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

/** The list body shared by all three Sample Management tabs (specialty / bulk /
 * forwarding). Formerly three byte-identical page files that differed only in which
 * TAB_REGISTRY config they loaded — now one component parameterized by `tab`. The
 * top tab strip is rendered once by SampleManagementLayout; this renders the
 * table + its own <Outlet/> for the row-drawer child route (`/:id`).
 *
 * Round 10: the Specialty and Commercial books get three views of the same rows —
 * Sends (the flat table), Coffees (one row per ref, sends nested) and Orders (the
 * book's consignments). The view is remembered per book (localStorage) and mirrored
 * in `?view=`; `?ref=` / `?consignment=` seed the filters so agent deep-links land. */
export default function SampleListView({ tab }: { tab: TabKey }) {
  const cfg = TAB_REGISTRY[tab];
  const book = BOOK_OF[tab] ?? null;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const storageKey = `sucafina-view-${tab}`;

  const [view, setView] = useState<ListView>(() => {
    if (!book) return 'sends';
    return asListView(searchParams.get('view')) ?? readStoredView(storageKey) ?? 'sends';
  });
  const [filters, setFilters] = useState<FilterState>(() => readListUrl(searchParams).filters);
  // Column show/hide UI was removed (feedback #7); we still resolve the default
  // visibility so the table keeps hiding the defaultHidden columns — it's just no
  // longer user-toggleable.
  const [visibility] = useColumnVisibility(`sucafina-cols-${cfg.endpoint}`, cfg.columns);
  const [createOpen, setCreateOpen] = useState(false);
  const highlightId = useRowHighlight(cfg.path);

  // Remember the view per book.
  useEffect(() => {
    if (!book) return;
    try {
      window.localStorage.setItem(storageKey, view);
    } catch {
      // private browsing / quota — the URL still carries it
    }
  }, [book, storageKey, view]);

  // State → URL (replace, so browsing views never piles up history). The current params are
  // read through a ref so this only runs when OUR state changes, never when the URL does.
  const spRef = useRef(searchParams);
  spRef.current = searchParams;
  useEffect(() => {
    const next = writeListUrl(spRef.current, filters, book ? view : 'sends');
    if (next.toString() !== spRef.current.toString()) setSearchParams(next, { replace: true });
  }, [filters, view, book, setSearchParams]);

  // URL → state: a `×3` pill or an agent link can change `?view=`/`?ref=` while this page is
  // mounted. Only the mirrored keys are compared, so nothing ping-pongs with the write above.
  useEffect(() => {
    const fromUrl = readListUrl(searchParams);
    if (book && fromUrl.view && fromUrl.view !== view) setView(fromUrl.view);
    setFilters((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of URL_KEYS) {
        const urlValue = fromUrl.filters[key];
        if (urlValue === undefined && key in prev) continue; // cleared locally, URL write pending
        if (urlValue !== undefined && prev[key] !== urlValue) {
          next[key] = urlValue;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const coffeeFilters = useMemo<FilterState>(() => {
    const next: FilterState = {};
    if (typeof filters.q === 'string') next.q = filters.q;
    if (typeof filters.ref === 'string') next.ref = filters.ref;
    return next;
  }, [filters.q, filters.ref]);
  const onSendClick = useCallback((send: { id: string }) => navigate(`${cfg.path}/${send.id}`), [navigate, cfg.path]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {book ? <ViewSwitch value={view} onChange={setView} /> : <span />}
        {cfg.createFields && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <IconPlus className="size-3.5" /> New
          </Button>
        )}
      </div>
      {(!book || view === 'sends') && (
        <>
          <FilterBar defs={cfg.filters} value={filters} onChange={setFilters} />
          <RecordTable
            endpoint={cfg.endpoint}
            columns={cfg.columns}
            filters={filters}
            onRowClick={(row) => navigate(`${cfg.path}/${String(row.id)}`)}
            columnVisibility={visibility}
            highlightId={highlightId}
            initialSort={cfg.defaultSort ?? null}
          />
        </>
      )}
      {book && view === 'coffees' && (
        <>
          <FilterBar defs={COFFEE_FILTERS} value={coffeeFilters} onChange={(next) => setFilters((prev) => ({ ...withoutKeys(prev, ['q', 'ref']), ...next }))} />
          <LotsTable
            book={book}
            filters={coffeeFilters}
            initialExpandedRef={typeof filters.ref === 'string' ? filters.ref : null}
            onSendClick={onSendClick}
          />
        </>
      )}
      {book && view === 'orders' && <ConsignmentsPage book={book} embedded />}
      {cfg.createFields && (
        <CreateRecordDialog
          endpoint={cfg.endpoint}
          entityLabel={cfg.entityLabel}
          fields={cfg.createFields}
          book={book ?? undefined}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      )}
      <Outlet />
    </>
  );
}

function withoutKeys(state: FilterState, keys: string[]): FilterState {
  const next = { ...state };
  for (const k of keys) delete next[k];
  return next;
}
