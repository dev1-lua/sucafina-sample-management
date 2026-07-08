import * as React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';

import { RecordTable } from './RecordTable';

// jsdom reports 0 for offsetWidth/offsetHeight, which makes @tanstack/react-virtual
// compute a zero-size viewport and render no rows at all. Give elements a stable,
// non-zero size so the virtualizer produces a real window of virtual items.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
});

function stubFetch(rows: Record<string, unknown>[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    return new Response(JSON.stringify({ data: rows, total: rows.length, page: 1, pageSize: 50 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}
const cols = [
  { key: 'ref', header: 'Ref', sortKey: 'ref' },
  { key: 'name', header: 'Name' },
];
const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

it('renders rows from the list payload', async () => {
  stubFetch([{ id: '1', ref: 'R1', name: 'Alpha' }]);
  render(wrap(<RecordTable endpoint="/specialty-samples" columns={cols} filters={{}} onRowClick={() => {}} />));
  await waitFor(() => expect(screen.getByText('R1')).toBeInTheDocument());
});

it('sortable header adds sort/order to the request; row click fires callback', async () => {
  const spy = stubFetch([{ id: '1', ref: 'R1', name: 'Alpha' }]);
  const onRow = vi.fn();
  render(wrap(<RecordTable endpoint="/specialty-samples" columns={cols} filters={{}} onRowClick={onRow} />));
  await waitFor(() => screen.getByText('R1'));
  fireEvent.click(screen.getByText('Ref'));
  await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes('sort=ref'))).toBe(true));
  fireEvent.click(screen.getByText('R1'));
  expect(onRow).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
});
