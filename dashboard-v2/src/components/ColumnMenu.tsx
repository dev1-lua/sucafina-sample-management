import * as React from 'react';
import { IconColumns3 } from '@tabler/icons-react';

import type { ColumnDef } from '@/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// Mirrors TanStack Table's `VisibilityState` shape (`{ [columnId]: boolean }`, absent
// key => visible) without importing the type — keeps this file decoupled from the
// table lib and reusable by any consumer that just wants a persisted show/hide map.
export type ColumnVisibilityState = Record<string, boolean>;

function defaultVisibility(columns: ColumnDef[]): ColumnVisibilityState {
  const state: ColumnVisibilityState = {};
  for (const col of columns) {
    if (col.defaultHidden) state[col.key] = false;
  }
  return state;
}

/** Column show/hide state, seeded from each column's `defaultHidden` and persisted to
 * localStorage under `storageKey` (per-tab: `sucafina-cols-<endpoint>`) so a user's
 * chosen columns survive a reload. */
export function useColumnVisibility(
  storageKey: string,
  columns: ColumnDef[],
): [ColumnVisibilityState, React.Dispatch<React.SetStateAction<ColumnVisibilityState>>] {
  const [visibility, setVisibility] = React.useState<ColumnVisibilityState>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw) as ColumnVisibilityState;
    } catch {
      // malformed/unavailable storage — fall through to curated defaults
    }
    return defaultVisibility(columns);
  });

  React.useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(visibility));
    } catch {
      // ignore write failures (private browsing quota, etc.)
    }
  }, [storageKey, visibility]);

  return [visibility, setVisibility];
}

export function ColumnMenu({
  columns,
  value,
  onChange,
}: {
  columns: ColumnDef[];
  value: ColumnVisibilityState;
  onChange: (next: ColumnVisibilityState) => void;
}) {
  function toggle(key: string) {
    const isVisible = value[key] !== false;
    onChange({ ...value, [key]: !isVisible });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <IconColumns3 className="size-3.5" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((col) => (
          <DropdownMenuCheckboxItem
            key={col.key}
            checked={value[col.key] !== false}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggle(col.key)}
          >
            {col.header}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
