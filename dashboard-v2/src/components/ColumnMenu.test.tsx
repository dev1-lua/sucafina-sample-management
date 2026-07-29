import { renderHook } from '@testing-library/react';

import { useColumnVisibility } from './ColumnMenu';
import type { ColumnDef } from '@/types';

const KEY = 'test-cols';

afterEach(() => window.localStorage.removeItem(KEY));

it('seeds defaultHidden columns as hidden when nothing is stored', () => {
  const columns: ColumnDef[] = [
    { key: 'a', header: 'A' },
    { key: 'b', header: 'B', defaultHidden: true },
  ];
  const { result } = renderHook(() => useColumnVisibility(KEY, columns));
  expect(result.current[0]).toEqual({ b: false });
});

it('a column added after the stored blob was written keeps its defaultHidden', () => {
  // User's blob predates the new column: it only knows about 'b' (re-shown by the user).
  window.localStorage.setItem(KEY, JSON.stringify({ b: true }));
  const columns: ColumnDef[] = [
    { key: 'a', header: 'A' },
    { key: 'b', header: 'B', defaultHidden: true },
    { key: 'new', header: 'New', defaultHidden: true }, // shipped later
  ];
  const { result } = renderHook(() => useColumnVisibility(KEY, columns));
  // Stored choice wins for 'b'; the new column stays curated-hidden instead of popping in.
  expect(result.current[0]).toEqual({ b: true, new: false });
});
