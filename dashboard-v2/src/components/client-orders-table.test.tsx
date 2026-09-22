import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ClientConsignmentsTable, ClientOrdersTable } from './client-orders-table';

const ORDERS = [
  { id: 'c-1', number: 'CN-1012', member_count: 3, derived_status: 'partly_dispatched', requested_by: 'Ivo', created_at: '2026-09-10T08:00:00Z', client_id: 'cl-1', client_name: 'EDMAX' },
];

function stubFetch(rows: unknown[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ data: rows, total: rows.length, page: 1, pageSize: 50 }), { status: 200 }),
  );
}

function renderTable() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ClientConsignmentsTable clientId="cl-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

it("lists the client's orders from GET /consignments?client_id= — number (linked), date, samples, status, requester", async () => {
  const spy = stubFetch(ORDERS);
  renderTable();
  expect(await screen.findByRole('link', { name: 'CN-1012' })).toHaveAttribute('href', '/consignments/c-1');
  expect(String(spy.mock.calls[0][0])).toMatch(/\/consignments\?.*client_id=cl-1/);
  expect(screen.getByText('2026-09-10')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();
  expect(screen.getByText('Partly dispatched')).toBeInTheDocument();
  expect(screen.getByText('Ivo')).toBeInTheDocument();
});

it('says so when the client has no orders', async () => {
  stubFetch([]);
  renderTable();
  expect(await screen.findByText('No orders for this client yet.')).toBeInTheDocument();
});

it('the per-sample history (now under a "Samples" heading) has a matching empty state', () => {
  render(
    <MemoryRouter>
      <ClientOrdersTable orders={[]} />
    </MemoryRouter>,
  );
  expect(screen.getByText('No samples sent to this client yet.')).toBeInTheDocument();
});
