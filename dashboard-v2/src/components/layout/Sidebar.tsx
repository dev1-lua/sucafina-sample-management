import type { ReactNode } from 'react';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  IconLayoutDashboard,
  IconFlask2,
  IconBox,
  IconTruckDelivery,
  IconUsers,
  IconChevronLeft,
  IconChevronDown,
  IconStar,
} from '@tabler/icons-react';

import { cn } from '@/lib/cn';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NAV_ICON_COLORS, type NavIconColor } from './nav-icon-colors';

const COLLAPSE_KEY = 'sucafina-sidebar-collapsed';

// `color` is additive (consumed only by Sidebar/Header for icon tinting) — the
// `{ label, path, icon }` shape other files destructure (CommandMenu, Header)
// stays intact.
export const NAV_ITEMS = [
  { label: 'Dashboard', path: '/', icon: IconLayoutDashboard, color: 'slate' },
  { label: 'Sample', path: '/samples', icon: IconFlask2, color: 'violet' },
  { label: 'Bulk', path: '/bulk', icon: IconBox, color: 'amber' },
  { label: 'Forwarding', path: '/forwarding', icon: IconTruckDelivery, color: 'blue' },
  { label: 'Clients', path: '/clients', icon: IconUsers, color: 'teal' },
] as const satisfies ReadonlyArray<{
  label: string;
  path: string;
  icon: typeof IconLayoutDashboard;
  color: NavIconColor;
}>;

function getInitialCollapsed(): boolean {
  return localStorage.getItem(COLLAPSE_KEY) === '1';
}

/** Small square brand mark shared by the sidebar header and its workspace popover. */
function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-primary text-xs font-semibold leading-none text-primary-foreground',
        className,
      )}
      aria-hidden="true"
    >
      S
    </span>
  );
}

/** Section label above a sidebar group (Favorites / Workspace) — small, muted, uppercase. */
function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2.5 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
      {children}
    </div>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200 ease-out',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      {/* Workspace switcher — brand mark + name + chevron, Twenty-style. Purely
          presentational for now (single workspace); the popover keeps the
          affordance honest rather than faking a working switcher. */}
      <div className={cn('flex h-12 shrink-0 items-center px-2', collapsed && 'justify-center px-0')}>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title="Sucafina workspace"
              className={cn(
                'flex h-8 flex-1 items-center gap-2 rounded-[4px] px-1.5 transition-colors duration-150 hover:bg-muted',
                collapsed && 'flex-none justify-center px-0',
              )}
            >
              <BrandMark />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate text-left text-sm font-semibold tracking-tight">Sucafina</span>
                  <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                </>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-1.5">
            <div className="px-1.5 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
              Workspace
            </div>
            <div className="flex items-center gap-2 rounded-[4px] bg-muted px-2 py-1.5 text-sm font-medium">
              <BrandMark />
              Sucafina
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-2">
        {/* Favorites — Tier-3 (per-user favorites) is out of scope; this is a
            tasteful, honest empty state rather than a faked list. */}
        <div>
          {!collapsed && <SectionLabel>Favorites</SectionLabel>}
          <div
            className={cn(
              'flex items-center gap-2.5 rounded-[4px] px-2.5 py-1.5 text-muted-foreground/60',
              collapsed && 'justify-center px-0',
            )}
            title={collapsed ? 'No favorites yet' : undefined}
          >
            <IconStar className="size-4 shrink-0" />
            {!collapsed && <span className="truncate text-xs italic">No favorites yet</span>}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-0.5">
          {!collapsed && <SectionLabel>Workspace</SectionLabel>}
          {NAV_ITEMS.map(({ label, path, icon: Icon, color }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-[4px] px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground',
                  collapsed && 'justify-center px-0',
                  // Twenty pattern: active = a soft neutral-gray highlight, never
                  // the blue accent (that stays reserved for the primary action /
                  // table-selection use), so the nav stays low-chrome.
                  isActive && 'bg-muted text-foreground',
                )
              }
            >
              <Icon className={cn('size-4 shrink-0', NAV_ICON_COLORS[color])} />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </div>
      </nav>

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={cn(
          'flex h-9 shrink-0 items-center gap-2 border-t border-border px-2.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground',
          collapsed && 'justify-center px-0',
        )}
      >
        <IconChevronLeft className={cn('size-4 shrink-0 transition-transform duration-200', collapsed && 'rotate-180')} />
        {!collapsed && <span className="text-xs">Collapse</span>}
      </button>
    </aside>
  );
}
