import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconLoader2 } from '@tabler/icons-react';

import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/StatusBadge';
import { useSearch, type SearchHit } from '@/lib/query';
import { NAV_ITEMS } from './Sidebar';

const SEARCH_DEBOUNCE_MS = 200;

/** DB tab keys don't line up 1:1 with route segments — `specialty` lives at `/samples`. */
function tabToPath(tab: string): string {
  return tab === 'specialty' ? 'samples' : tab;
}

export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  // Global ⌘K / Ctrl+K toggle — lives here so the palette is self-sufficient
  // regardless of which trigger (Header button, shortcut) opened it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  // Debounce keystrokes before hitting the search endpoint.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Reset the query once the dialog closes so it reopens fresh.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setDebounced('');
    }
  }, [open]);

  const { data, isFetching } = useSearch(debounced);
  const hits = data?.data ?? [];
  const trimmed = debounced.trim();

  function go(path: string) {
    onOpenChange(false);
    navigate(path);
  }

  function selectHit(hit: SearchHit) {
    go(`/${tabToPath(hit.tab)}/${hit.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 [&>button]:hidden">
        <DialogTitle className="sr-only">Command menu</DialogTitle>
        <Command
          shouldFilter={false}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:size-4 [&_[cmdk-input]]:h-9 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-1.5 [&_[cmdk-item]_svg]:size-4"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search records or jump to a section…"
          />
          <CommandList>
            <CommandGroup heading="Go to">
              {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
                <CommandItem key={path} value={label} onSelect={() => go(path)}>
                  <Icon className="size-4" />
                  <span>{label}</span>
                </CommandItem>
              ))}
            </CommandGroup>

            {trimmed && (
              <CommandGroup heading="Records">
                {isFetching && hits.length === 0 && (
                  <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                    <IconLoader2 className="size-3.5 animate-spin" />
                    Searching…
                  </div>
                )}
                {!isFetching && hits.length === 0 && (
                  <div className="px-2 py-3 text-xs text-muted-foreground">No records match “{trimmed}”.</div>
                )}
                {hits.map((hit) => (
                  <CommandItem key={`${hit.tab}-${hit.id}`} value={`${hit.tab}-${hit.id}`} onSelect={() => selectHit(hit)}>
                    <span className="flex-1 truncate">
                      {hit.title ?? hit.ref ?? hit.id}
                      {hit.receiver && <span className="ml-1.5 text-muted-foreground">— {hit.receiver}</span>}
                    </span>
                    <StatusBadge kind="status" value={hit.status} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
