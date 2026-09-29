import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import SampleListView from './SampleListView';

// See RecordTable.test.tsx: the virtualizer needs a non-zero viewport under jsdom.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
});

const LOT = {
  ref: 'TYPE-113', book: 'commercial', coffee_key: 'k', outturn: null, grade: null, quality: 'AB FAQ', blend: null,
  first_issued_at: '2026-06-01T00:00:00Z', sends: 2, open_sends: 0, delivered_sends: 2, last_send_on: '2026-06-24', last_receiver: 'Joh Johanson', status_rollup: '2 delivered',
};
const SEND = { tab: 'bulk', id: 'u-9', send_id: 'SS-1009', receiver: 'Joh Johanson', date_on: '2026-06-24', status: 'delivered', qty_grams: 300, courier_norm: 'dhl', awb: null, title: 'AB FAQ', consignment_number: null };
// Round 11: the Clients view (GET /client-sends?book= + /client-sends/:key?book=).
const CLIENT_ROW = {
  key: 'name:joh johanson', client_id: null, client_name: 'Joh Johanson', sends: 2, coffees: 1, open_sends: 0, in_transit: 0, delivered_sends: 2,
  awaiting_results: 1, approved: 1, rejected: 0, last_send_on: '2026-06-24', last_ref: 'TYPE-113', status_rollup: '2 delivered',
};
const CLIENT_SEND = { tab: 'bulk', id: 'u-9', send_id: 'SS-1009', ref: 'TYPE-113', option_letter: null, title: 'AB FAQ', qty_grams: 300, date_on: '2026-06-24', status: 'delivered', courier_norm: 'dhl', awb: '55', result_norm: 'approved', consignment_number: null, lot_sends: 2 };

function stubFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    let body: unknown;
    if (/\/lots\/[^?]/.test(url)) body = { lot: LOT, sends: [SEND] };
    else if (url.includes('/lots?')) body = { data: [LOT], total: 1, page: 1, pageSize: 50 };
    else if (/\/client-sends\/[^?]/.test(url)) body = { client: { key: CLIENT_ROW.key, client_id: null, client_name: 'Joh Johanson' }, sends: [CLIENT_SEND] };
    else if (url.includes('/client-sends?')) body = { data: [CLIENT_ROW], total: 1, page: 1, pageSize: 50 };
    else if (url.includes('/clients')) body = { data: [], total: 0, page: 1, pageSize: 200 };
    else if (url.includes('/consignments')) body = { data: [{ id: 'c-1', number: 'CN-1012', member_count: 2, derived_status: 'delivered', client_name: 'EDMAX', created_at: '2026-09-01T00:00:00Z' }], total: 1, page: 1, pageSize: 50 };
    else body = { data: [{ id: 'u-9', send_id: 'SS-1009', sample_ref: 'TYPE-113', quality: 'AB FAQ', client: 'Joh Johanson', status: 'delivered', lot_sends: 2 }], total: 1, page: 1, pageSize: 50 };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

function Location() {
  const loc = useLocation();
  return (
    <>
      <output data-testid="search">{loc.search}</output>
      <output data-testid="path">{loc.pathname}</output>
    </>
  );
}

function renderAt(path: string, tab: 'bulk' | 'forwarding' = 'bulk') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path={`/${tab}`} element={<SampleListView tab={tab} />} />
        </Routes>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* jsdom */ }
});
afterEach(() => vi.restoreAllMocks());

const urls = (spy: ReturnType<typeof stubFetch>) => spy.mock.calls.map(([u]) => String(u));

it('`?view=coffees&ref=` opens the Coffees view with that lot expanded; switching to Sends keeps the ref filter and rewrites the URL', async () => {
  const spy = stubFetch();
  renderAt('/bulk?view=coffees&ref=TYPE-113');
  const coffees = screen.getByRole('button', { name: 'Coffees' });
  expect(coffees).toHaveAttribute('aria-pressed', 'true');
  // The lot list is asked for this book + ref, and the lot arrives already expanded.
  await waitFor(() => expect(urls(spy).some((u) => /\/lots\?.*book=commercial.*q=TYPE-113/.test(u))).toBe(true));
  expect(await screen.findByText('2 delivered')).toBeInTheDocument();
  expect(await screen.findByText('Joh Johanson', { selector: 'span.truncate' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Sends' }));
  expect(screen.getByRole('button', { name: 'Sends' })).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?ref=TYPE-113'));
  await waitFor(() => expect(urls(spy).some((u) => /\/bulk-samples\?.*ref=TYPE-113/.test(u))).toBe(true));
  expect(window.localStorage.getItem('sucafina-view-bulk')).toBe('sends');
  // The Sends view shows the re-send pill for the row.
  expect(await screen.findByRole('link', { name: '2 sends of this coffee' })).toBeInTheDocument();
});

it('the chosen view is remembered per book and mirrored into the URL on load', async () => {
  stubFetch();
  window.localStorage.setItem('sucafina-view-bulk', 'orders');
  renderAt('/bulk');
  expect(screen.getByRole('button', { name: 'Orders' })).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?view=orders'));
  expect(await screen.findByText('CN-1012')).toBeInTheDocument();
});

it('clearing the Ref chip drops it from the URL', async () => {
  stubFetch();
  renderAt('/bulk?ref=TYPE-113');
  await screen.findByText('AB FAQ');
  fireEvent.click(screen.getByRole('button', { name: /clear ref filter/i }));
  await waitFor(() => expect(screen.getByTestId('search').textContent).toBe(''));
});

it('the Forwarding book has no view switch', async () => {
  stubFetch();
  renderAt('/forwarding', 'forwarding');
  expect(screen.queryByRole('group', { name: /view/i })).not.toBeInTheDocument();
  // …but still says what a row is, and leads with the send id.
  expect(screen.getByText('One row per send — every sample requested or sent, each with its own Send ID.')).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Send ID' })).toBeInTheDocument();
});

// --- Round 11: Send ID column, per-view hints, the Clients view ------------------------------------

it('the Sends view leads with a monospace Send ID column whose header explains ref vs send id; the client cell links to the Clients view', async () => {
  stubFetch();
  renderAt('/bulk');
  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
  expect(headers[0]).toBe('Send ID');
  expect(screen.getByRole('columnheader', { name: 'Send ID' })).toHaveAttribute(
    'title',
    'Unique to this send. The reference names the coffee and is shared by every send of it.',
  );
  expect(await screen.findByText('SS-1009')).toHaveClass('font-mono');
  expect(screen.getByText('One row per send — every sample requested or sent, each with its own Send ID.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Joh Johanson' })).toHaveAttribute('href', '/bulk?view=clients&client=Joh%20Johanson');
});

it('the Ref filter chip says it takes a send id too', async () => {
  stubFetch();
  renderAt('/bulk');
  fireEvent.click(screen.getByRole('button', { name: 'Ref' }));
  expect(await screen.findByPlaceholderText('Ref or Send ID')).toBeInTheDocument();
});

it('each view carries its own hint beside the switch', async () => {
  stubFetch();
  renderAt('/bulk');
  fireEvent.click(screen.getByRole('button', { name: 'Coffees' }));
  expect(screen.getByText(/One row per reference\. A reference names the coffee/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Orders' }));
  expect(screen.getByText('One row per order (CN number): the samples of one request to one client.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clients' }));
  expect(screen.getByText('One row per client. Expand to see every coffee sent to them.')).toBeInTheDocument();
});

it('`?view=clients&client=` opens the Clients view on that exact name (`client=`, not `q=`) with the client expanded; the chip clears the URL key', async () => {
  const spy = stubFetch();
  renderAt('/bulk?view=clients&client=Joh%20Johanson');
  expect(screen.getByRole('button', { name: 'Clients' })).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => expect(urls(spy).some((u) => /\/client-sends\?.*book=commercial.*client=Joh\+Johanson/.test(u))).toBe(true));
  // Exact match only: the name never rides along as the fuzzy `q=`.
  expect(urls(spy).some((u) => /\/client-sends\?.*q=Joh/.test(u))).toBe(false);
  expect(await screen.findByText('2 delivered')).toBeInTheDocument();
  // The first row arrives expanded: its sends are fetched by URL-encoded key and nested.
  await waitFor(() => expect(urls(spy).some((u) => /\/client-sends\/name%3Ajoh%20johanson\?book=commercial$/.test(u))).toBe(true));
  expect(await screen.findByText('dhl · 55')).toBeInTheDocument();
  expect(screen.getByText('1 client')).toBeInTheDocument();
  expect(window.localStorage.getItem('sucafina-view-bulk')).toBe('clients');

  fireEvent.click(screen.getByRole('button', { name: /clear client filter/i }));
  await waitFor(() => expect(screen.getByTestId('search').textContent).toBe('?view=clients'));
});

it('a nested client send opens that sample\'s drawer route', async () => {
  stubFetch();
  renderAt('/bulk?view=clients&client=Joh%20Johanson');
  const send = await screen.findByText('dhl · 55');
  fireEvent.click(send);
  await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/bulk/u-9'));
});
