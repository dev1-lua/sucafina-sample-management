import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ContractsPage from './ContractsPage';

// jsdom reports 0 for offsetWidth/offsetHeight, which makes RecordTable's virtualizer compute a
// zero-size viewport and render no rows at all (see RecordTable.test.tsx).
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
});

const ROWS = [
  {
    id: 'c-1',
    contract_number: 'CT-2026-14',
    client_name: 'Paulig',
    quality: 'AB FAQ',
    destination: 'Finland',
    shipment_date: '2026-10-20',
    pss_due_date: '2026-09-05',
    containers: 2,
    status: 'pss_pending',
    pss_counts: { expected: 2, approved: 1, rejected: 0, pending: 1 },
  },
];

function stubFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ data: ROWS, total: ROWS.length, page: 1, pageSize: 50 }), { status: 200 }),
  );
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ContractsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

it('lists contracts with their PSS progress and status', async () => {
  stubFetch();
  renderPage();
  expect(await screen.findByText('CT-2026-14')).toBeInTheDocument();
  expect(screen.getByText('Paulig')).toBeInTheDocument();
  // approved / expected chip + the derived status pill.
  expect(screen.getByText('1 of 2')).toBeInTheDocument();
  expect(screen.getByText('PSS pending')).toBeInTheDocument();
  // A due date already past reads as overdue in the cell, not as a bare date.
  expect(screen.getByText(/^2026-09-05 · overdue \d+d$/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /new contract/i })).toBeInTheDocument();
});
