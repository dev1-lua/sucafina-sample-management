import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  IconLayoutDashboard,
  IconFlask2,
  IconBox,
  IconTruckDelivery,
  IconUsers,
  IconChevronLeft,
} from '@tabler/icons-react';

import { cn } from '@/lib/cn';

const COLLAPSE_KEY = 'sucafina-sidebar-collapsed';

export const NAV_ITEMS = [
  { label: 'Dashboard', path: '/', icon: IconLayoutDashboard },
  { label: 'Sample', path: '/samples', icon: IconFlask2 },
  { label: 'Bulk', path: '/bulk', icon: IconBox },
  { label: 'Forwarding', path: '/forwarding', icon: IconTruckDelivery },
  { label: 'Clients', path: '/clients', icon: IconUsers },
] as const;

function getInitialCollapsed(): boolean {
  return localStorage.getItem(COLLAPSE_KEY) === '1';
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
        'flex h-full shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-out',
        collapsed ? 'w-14' : 'w-56',
      )}
    >
      <div className={cn('flex h-12 shrink-0 items-center gap-2 px-4', collapsed && 'justify-center px-0')}>
        <span className="text-base leading-none" aria-hidden="true">
          ☕
        </span>
        {!collapsed && <span className="truncate text-sm font-semibold tracking-tight">Sucafina</span>}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-[4px] px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground',
                collapsed && 'justify-center px-0',
                isActive && 'bg-accent text-accent-foreground',
              )
            }
          >
            <Icon className="size-4 shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={cn(
          'flex h-9 shrink-0 items-center gap-2 border-t border-border px-2.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground',
          collapsed && 'justify-center px-0',
        )}
      >
        <IconChevronLeft className={cn('size-4 shrink-0 transition-transform duration-200', collapsed && 'rotate-180')} />
        {!collapsed && <span className="text-xs">Collapse</span>}
      </button>
    </aside>
  );
}
