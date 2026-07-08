import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { IconSearch } from '@tabler/icons-react';

import { cn } from '@/lib/cn';
import { CommandMenu } from './CommandMenu';
import { ThemeToggle } from './ThemeToggle';
import { NAV_ITEMS } from './Sidebar';
import { NAV_ICON_COLORS } from './nav-icon-colors';

function activeNavItem(pathname: string) {
  return NAV_ITEMS.find((item) => item.path !== '/' && pathname.startsWith(item.path)) ?? NAV_ITEMS[0];
}

export function Header() {
  const location = useLocation();
  const [commandOpen, setCommandOpen] = useState(false);
  const active = activeNavItem(location.pathname);
  const ActiveIcon = active.icon;

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-muted', NAV_ICON_COLORS[active.color])}>
          <ActiveIcon className="size-3.5" />
        </span>
        <h1 className="truncate text-sm font-semibold">{active.label}</h1>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="flex h-7 w-56 items-center gap-2 rounded-[4px] border border-border bg-background px-2.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
        >
          <IconSearch className="size-3.5 shrink-0" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded-[4px] border border-border bg-muted px-1 py-0.5 font-mono text-2xs leading-none">⌘K</kbd>
        </button>
        <ThemeToggle />
      </div>

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </header>
  );
}
