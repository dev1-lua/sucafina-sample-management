import * as React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { DetailDrawer } from './DetailDrawer';
import type { DetailField } from '@/types';

const detail = {
  id: '1',
  ref: 'REF-001',
  status: 'requested',
  events: [
    {
      id: 'e1',
      entity_type: 'specialty',
      entity_id: '1',
      type: 'created',
      note: 'AB for Beyers',
      actor: 'seed',
      created_at: '2026-07-01T00:00:00Z',
    },
  ],
};

// Same fetch-stub shape as RecordTable.test.tsx: branch on HTTP method so a PATCH
// round-trips a body we can assert on, while GET always serves the fixed detail row.
function stubFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const method = (init as RequestInit | undefined)?.method ?? 'GET';
    const body = method === 'PATCH' ? { ...detail, ...JSON.parse(String((init as RequestInit).body)) } : detail;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

const fields: DetailField[] = [
  { key: 'status', label: 'Status', edit: { field: 'status', type: 'text' } },
];

// DetailDrawer now reads router state (useRecordHighlight) as it always does in
// the app (mounted under BrowserRouter via TabDrawerRoute) — so tests render it
// inside a MemoryRouter. Default location '/' carries no ?hl, so no banner shows.
const wrap = (ui: React.ReactNode) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
  </MemoryRouter>
);

it('renders the ref, shows timeline events on tab switch, and PATCHes on inline edit commit', async () => {
  const user = userEvent.setup();
  const spy = stubFetch();
  render(
    wrap(
      <DetailDrawer endpoint="/specialty-samples" id="1" open onClose={() => {}} fields={fields} />,
    ),
  );

  await waitFor(() => expect(screen.getByText('REF-001')).toBeInTheDocument());

  // Radix Tabs activates on focus (automatic activation mode), which jsdom only
  // wires up via a full pointer sequence -- plain fireEvent.click doesn't move
  // focus, so tab switching needs userEvent here.
  await user.click(screen.getByRole('tab', { name: /timeline/i }));
  await waitFor(() => expect(screen.getByText(/AB for Beyers/)).toBeInTheDocument());

  await user.click(screen.getByRole('tab', { name: /details/i }));
  const input = await screen.findByDisplayValue('requested');
  fireEvent.change(input, { target: { value: 'dispatched' } });
  fireEvent.blur(input);

  await waitFor(() => {
    const patchCall = spy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    expect(patchCall).toBeDefined();
    expect(JSON.parse(String((patchCall![1] as RequestInit).body))).toEqual({ status: 'dispatched' });
  });
});

it('shows a labeled Phase-4 boundary on the Related tab', async () => {
  const user = userEvent.setup();
  stubFetch();
  render(wrap(<DetailDrawer endpoint="/specialty-samples" id="1" open onClose={() => {}} fields={fields} />));
  await waitFor(() => expect(screen.getByText('REF-001')).toBeInTheDocument());
  await user.click(screen.getByRole('tab', { name: /related/i }));
  expect(screen.getByText(/coming in Phase 4/i)).toBeInTheDocument();
});
