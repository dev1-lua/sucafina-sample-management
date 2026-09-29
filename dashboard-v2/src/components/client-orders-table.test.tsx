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

// Round 11: every row leads with its send id (monospace); the header carries the ref-vs-send-id tooltip.
it('the per-sample history leads with a Send ID column', () => {
  render(
    <MemoryRouter>
      <ClientOrdersTable
        orders={[
          { tab: 'specialty', id: 'u-1', send_id: 'SS-1001', ref: 'SL-7336', title: 'KII AB', status: 'delivered', courier_norm: 'dhl', awb: '778', date_on: '2026-06-10', delivery_on: null, result_norm: 'approved', blend: null, strategy: null, highlights: null, result_on: null },
          { tab: 'bulk', id: 'u-2', ref: 'TYPE-113', title: 'AB FAQ', status: 'requested', courier_norm: null, awb: null, date_on: '2026-06-01', delivery_on: null, result_norm: null, blend: null, strategy: null, highlights: null, result_on: null },
        ]}
      />
    </MemoryRouter>,
  );
  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
  expect(headers[0]).toBe('Send ID');
  expect(screen.getByRole('columnheader', { name: 'Send ID' })).toHaveAttribute('title', expect.stringMatching(/Unique to this send/));
  expect(screen.getByText('SS-1001')).toHaveClass('font-mono');
  // A legacy row without one shows the em-dash in that cell.
  const legacy = screen.getByText('TYPE-113').closest('tr')!;
  expect(legacy.querySelector('td')?.textContent).toBe('—');
});

it('the per-sample history (now under a "Samples" heading) has a matching empty state', () => {
  render(
    <MemoryRouter>
      <ClientOrdersTable orders={[]} />
    </MemoryRouter>,
  );
  expect(screen.getByText('No samples sent to this client yet.')).toBeInTheDocument();
});
