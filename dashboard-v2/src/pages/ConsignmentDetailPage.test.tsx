import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ConsignmentDetailPage from './ConsignmentDetailPage';

// contracts.md §6: the detail carries client/requester/derived status and richer members.
const ORDER = {
  id: 'c-1', number: 'CN-1012', location: 'thika', status: 'open', notes: null, member_count: 2,
  created_at: '2026-09-10T08:00:00Z', client_id: 'cl-1', client_name: 'EDMAX', requested_by: 'Ivo', logged_by: 'Harriet',
  derived_status: 'partly_dispatched', events: [],
  members: [
    { tab: 'specialty', id: 'u-2', ref: 'SL-7336', title: 'KII AB', receiver: 'EDMAX', status: 'dispatched', outturn: '08KN0021', grade: 'AB', sample_type_norm: 'offer', qty_grams: 500, awb: '778', courier_norm: 'dhl', dispatched_on: '2026-09-11', date_on: '2026-09-10' },
    { tab: 'bulk', id: 'u-7', ref: 'TYPE-113', title: 'AB FAQ', receiver: 'EDMAX', status: 'requested', outturn: null, grade: null, sample_type_norm: 'type', qty_grams: 300, awb: null, courier_norm: null, dispatched_on: null, date_on: '2026-09-10' },
  ],
};
const CANDIDATES = [
  { tab: 'specialty', id: 'u-9', ref: 'SL-8000', title: 'KII AA', receiver: 'Paulig', status: 'requested', date_on: '2026-09-12', consignment_number: null, awb: null, courier_norm: null },
  { tab: 'specialty', id: 'u-8', ref: 'SL-8000', title: 'KII AA', receiver: 'Beyers', status: 'delivered', date_on: '2026-08-01', consignment_number: 'CN-1001', awb: '5', courier_norm: 'dhl' },
];

function stubFetch(candidates = CANDIDATES) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    let body: unknown = ORDER;
    if (url.includes('/samples/resolve')) body = { ref: 'SL-8000', candidates };
    else if (method === 'POST' && url.endsWith('/dispatch')) body = { updated: 2 };
    else if (method === 'POST') body = { ok: true };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/consignments/c-1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/consignments/:id" element={<ConsignmentDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

const postCalls = (spy: ReturnType<typeof stubFetch>) =>
  spy.mock.calls.filter(([, init]) => init?.method === 'POST').map(([u, init]) => ({ url: String(u), body: JSON.parse(String(init!.body)) }));

it('header shows client (linked), requester, logger, derived status and date; members carry coffee, qty, courier/AWB, status', async () => {
  stubFetch();
  renderPage();
  expect(await screen.findByRole('heading', { name: 'CN-1012' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'EDMAX' })).toHaveAttribute('href', '/clients/cl-1');
  expect(screen.getByText(/Requested by Ivo/)).toBeInTheDocument();
  expect(screen.getByText(/Logged by Harriet/)).toBeInTheDocument();
  expect(screen.getByText('Partly dispatched')).toBeInTheDocument();
  expect(screen.getByText(/2026-09-10/)).toBeInTheDocument();
  // Member rows.
  expect(screen.getByText('08KN0021 · AB')).toBeInTheDocument();
  expect(screen.getByText('500 g')).toBeInTheDocument();
  expect(screen.getByText('dhl · 778')).toBeInTheDocument();
  expect(screen.getByText('AB FAQ')).toBeInTheDocument();
  expect(screen.getByText('dispatched')).toBeInTheDocument();
});

it('Dispatch all: courier + AWB (+ date) → POST /consignments/:id/dispatch', async () => {
  const user = userEvent.setup();
  const spy = stubFetch();
  renderPage();
  await screen.findByRole('heading', { name: 'CN-1012' });
  await user.click(screen.getByRole('button', { name: /dispatch all/i }));
  const dialog = await screen.findByRole('dialog', { name: /dispatch all/i });
  await user.selectOptions(screen.getByLabelText('Courier'), 'dhl');
  await user.type(screen.getByLabelText('AWB'), '1234567890');
  fireEvent.change(screen.getByLabelText('Dispatched on'), { target: { value: '2026-09-22' } });
  await user.click(screen.getByRole('button', { name: /^dispatch 2 samples$/i }));
  await waitFor(() => {
    const post = postCalls(spy).find((c) => c.url.endsWith('/consignments/c-1/dispatch'));
    expect(post).toBeTruthy();
    expect(post!.body).toEqual({ courier: 'dhl', awb: '1234567890', dispatched_on: '2026-09-22' });
  });
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
});

it('adding by ref resolves via GET /samples/resolve and offers a picker when several sends match', async () => {
  const user = userEvent.setup();
  const spy = stubFetch();
  renderPage();
  await screen.findByRole('heading', { name: 'CN-1012' });
  await user.type(screen.getByPlaceholderText(/add by ref/i), 'SL-8000');
  await user.click(screen.getByRole('button', { name: /^add$/i }));
  // Two candidates → pick which send is meant (receiver · date · status).
  const picker = await screen.findByRole('group', { name: /which send/i });
  expect(spy.mock.calls.some(([u]) => /\/samples\/resolve\?ref=SL-8000/.test(String(u)))).toBe(true);
  expect(picker).toHaveTextContent('Paulig');
  expect(picker).toHaveTextContent('Beyers');
  expect(picker).toHaveTextContent('2026-08-01');
  await user.click(screen.getByRole('button', { name: /Beyers/ }));
  await waitFor(() => {
    const post = postCalls(spy).find((c) => c.url.endsWith('/consignments/c-1/samples'));
    expect(post?.body).toEqual({ tab: 'specialty', ids: ['u-8'] });
  });
});

it('a single match is added straight away; no match shows an error', async () => {
  const user = userEvent.setup();
  const spy = stubFetch([CANDIDATES[0]]);
  renderPage();
  await screen.findByRole('heading', { name: 'CN-1012' });
  await user.type(screen.getByPlaceholderText(/add by ref/i), 'SL-8000');
  await user.click(screen.getByRole('button', { name: /^add$/i }));
  await waitFor(() => {
    const post = postCalls(spy).find((c) => c.url.endsWith('/consignments/c-1/samples'));
    expect(post?.body).toEqual({ tab: 'specialty', ids: ['u-9'] });
  });

  vi.restoreAllMocks();
  stubFetch([]);
  await user.type(screen.getByPlaceholderText(/add by ref/i), 'SL-1');
  await user.click(screen.getByRole('button', { name: /^add$/i }));
  expect(await screen.findByText(/No sample matching/)).toBeInTheDocument();
});
