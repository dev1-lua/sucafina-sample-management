import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { IconSearch } from '@tabler/icons-react';

import { CommandMenu } from './CommandMenu';
import { ThemeToggle } from './ThemeToggle';
import { NAV_ITEMS } from './Sidebar';

function sectionTitle(pathname: string): string {
  const match = NAV_ITEMS.find((item) => item.path !== '/' && pathname.startsWith(item.path));
  return match?.label ?? 'Dashboard';
}

export function Header() {
  const location = useLocation();
  const [commandOpen, setCommandOpen] = useState(false);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
      <h1 className="truncate text-sm font-semibold">{sectionTitle(location.pathname)}</h1>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="flex h-7 w-56 items-center gap-2 rounded-[4px] border border-border bg-background px-2.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground"
        >
          <IconSearch className="size-3.5 shrink-0" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded-[4px] border border-border bg-muted px-1 py-0.5 font-mono text-[10px] leading-none">⌘K</kbd>
        </button>
        <ThemeToggle />
      </div>

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </header>
  );
}
