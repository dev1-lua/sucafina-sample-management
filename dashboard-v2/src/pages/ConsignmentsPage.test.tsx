import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ConsignmentsPage from './ConsignmentsPage';

// See RecordTable.test.tsx: the virtualizer needs a non-zero viewport under jsdom.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
});

// contracts.md §6: list rows carry client + requester + the derived status.
const ORDERS = [
  { id: 'c-1', number: 'CN-1012', location: 'thika', status: 'open', notes: null, member_count: 3, created_at: '2026-09-10T08:00:00Z', client_id: 'cl-1', client_name: 'EDMAX', requested_by: 'Ivo', logged_by: 'Harriet', derived_status: 'partly_dispatched' },
  { id: 'c-2', number: 'CN-1013', location: null, status: 'open', notes: null, member_count: 1, created_at: '2026-09-11T08:00:00Z', client_id: 'cl-2', client_name: 'Paulig', requested_by: 'Muki', logged_by: null, derived_status: 'requested' },
];
const CLIENTS = [
  { id: 'cl-1', name: 'EDMAX' },
  { id: 'cl-2', name: 'Paulig' },
];

function stubFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes('/clients') ? { data: CLIENTS, total: 2, page: 1, pageSize: 200 } : { data: ORDERS, total: ORDERS.length, page: 1, pageSize: 50 };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

function renderPage(props: React.ComponentProps<typeof ConsignmentsPage> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ConsignmentsPage {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

const consignmentCalls = (spy: ReturnType<typeof stubFetch>) => spy.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/consignments?'));

it('lists orders with client, requester, sample count, derived status badge and date', async () => {
  const spy = stubFetch();
  renderPage();
  expect(await screen.findByText('CN-1012')).toBeInTheDocument();
  expect(screen.getByText('EDMAX')).toBeInTheDocument();
  expect(screen.getByText('Ivo')).toBeInTheDocument();
  expect(screen.getByText('Partly dispatched')).toBeInTheDocument();
  expect(screen.getByText('2026-09-10')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /new consignment/i })).toBeInTheDocument();
  // No book preset → the Book chip is offered and nothing is sent for it.
  expect(screen.getByText('Book')).toBeInTheDocument();
  expect(consignmentCalls(spy)[0]).not.toContain('book=');
});

it('a preset book is sent on every request and the Book chip disappears (the book pages’ Orders view)', async () => {
  const spy = stubFetch();
  renderPage({ book: 'commercial' });
  await screen.findByText('CN-1012');
  expect(consignmentCalls(spy)[0]).toContain('book=commercial');
  expect(screen.queryByText('Book')).not.toBeInTheDocument();
});

it('picking a client from the Client chip filters by client_id', async () => {
  const spy = stubFetch();
  renderPage();
  await screen.findByText('CN-1012');
  fireEvent.click(screen.getByRole('button', { name: 'Client' }));
  fireEvent.click(await screen.findByLabelText('Paulig'));
  await waitFor(() => expect(consignmentCalls(spy).some((u) => u.includes('client_id=cl-2'))).toBe(true));
  expect(consignmentCalls(spy).at(-1)).not.toContain('client=');
});
