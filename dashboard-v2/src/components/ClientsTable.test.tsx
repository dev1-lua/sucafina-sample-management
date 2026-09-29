import * as React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { ClientsTable } from './ClientsTable';

// See RecordTable.test.tsx: the virtualizer needs a non-zero viewport under jsdom.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
});

// Round 11 spec §3: GET /client-sends?book= rows and GET /client-sends/:key?book= detail.
const CLIENTS = [
  {
    key: 'id:cl-1', client_id: 'cl-1', client_name: 'CK Corporation', sends: 3, coffees: 2, open_sends: 1, in_transit: 0, delivered_sends: 2,
    awaiting_results: 1, approved: 1, rejected: 0, last_send_on: '2026-08-20', last_ref: 'SSKE-104929B', status_rollup: '2 delivered · 1 pending',
  },
  {
    key: 'name:paulig', client_id: null, client_name: 'Paulig', sends: 1, coffees: 1, open_sends: 1, in_transit: 0, delivered_sends: 0,
    awaiting_results: 0, approved: 0, rejected: 0, last_send_on: '2026-06-02', last_ref: 'SL-8001', status_rollup: '1 pending',
  },
];
const CK_SENDS = {
  client: { key: 'id:cl-1', client_id: 'cl-1', client_name: 'CK Corporation' },
  sends: [
    { tab: 'bulk', id: 'b-2', send_id: 'SS-2002', ref: 'SSKE-104929B', option_letter: 'B', title: 'AB FAQ', qty_grams: 300, date_on: '2026-08-20', status: 'requested', courier_norm: null, awb: null, result_norm: null, consignment_number: 'CN-2001', lot_sends: 2 },
    { tab: 'bulk', id: 'b-1', send_id: 'SS-2001', ref: 'SSKE-104929A', option_letter: 'A', title: 'AB FAQ', qty_grams: 300, date_on: '2026-08-05', status: 'delivered', courier_norm: 'dhl', awb: '990', result_norm: 'approved', consignment_number: null, lot_sends: 2 },
    // A legacy row: no send id yet, letter only in the column.
    { tab: 'bulk', id: 'b-0', send_id: null, ref: 'TYPE-113', option_letter: null, title: 'C FAQ', qty_grams: 500, date_on: '2026-07-01', status: 'delivered', courier_norm: 'fedex', awb: '12', result_norm: 'rejected', consignment_number: null, lot_sends: 1 },
  ],
};

function stubFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const body = /\/client-sends\/[^?]/.test(url) ? CK_SENDS : { data: CLIENTS, total: CLIENTS.length, page: 1, pageSize: 50 };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

function renderTable(props: Partial<React.ComponentProps<typeof ClientsTable>> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ClientsTable book="commercial" filters={{}} onSendClick={() => {}} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

it('lists one row per client from GET /client-sends?book= with counts, roll-up and last send; nothing per client until expanded', async () => {
  const spy = stubFetch();
  renderTable();
  expect(await screen.findByText('CK Corporation')).toBeInTheDocument();
  expect(String(spy.mock.calls[0][0])).toMatch(/\/client-sends\?.*book=commercial/);
  expect(String(spy.mock.calls[0][0])).toMatch(/sort=last_send_on/);
  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
  expect(headers).toEqual(['', 'Client', 'Coffees', 'Sends', 'Open', 'Awaiting result', 'Approved', 'Rejected', 'Last send', 'Status']);
  expect(screen.getByText('2 delivered · 1 pending')).toBeInTheDocument();
  expect(screen.getByText('2026-08-20')).toBeInTheDocument();
  expect(screen.getByText('2 clients')).toBeInTheDocument();
  expect(spy.mock.calls.some(([u]) => /\/client-sends\//.test(String(u)))).toBe(false);
});

it('expanding a client fetches GET /client-sends/:key?book= (key encoded) and nests its sends newest first, send id leading', async () => {
  const spy = stubFetch();
  const onSend = vi.fn();
  renderTable({ onSendClick: onSend });
  await screen.findByText('CK Corporation');
  fireEvent.click(screen.getByRole('button', { name: 'Toggle sends to CK Corporation' }));
  expect(await screen.findByText('dhl · 990')).toBeInTheDocument();
  expect(spy.mock.calls.some(([u]) => /\/client-sends\/id%3Acl-1\?book=commercial$/.test(String(u)))).toBe(true);

  const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
  const idx = (needle: string) => rows.findIndex((t) => t.includes(needle));
  expect(idx('CN-2001')).toBeGreaterThan(idx('CK Corporation'));
  expect(idx('dhl · 990')).toBeGreaterThan(idx('CN-2001'));
  expect(idx('fedex · 12')).toBeGreaterThan(idx('dhl · 990'));
  expect(idx('Paulig')).toBeGreaterThan(idx('fedex · 12'));
  // Send ID · Date · Ref · Coffee · Qty · Courier/AWB · Status · Result · Order — the child header names them.
  expect(rows[idx('CN-2001')]!.startsWith('SS-2002')).toBe(true);
  expect(screen.getByText('SS-2002')).toHaveClass('font-mono');
  expect(screen.getByText('Send ID')).toHaveAttribute('title', expect.stringMatching(/Unique to this send/));
  expect(screen.getByText('Coffee')).toBeInTheDocument();
  expect(screen.getByText('Result')).toBeInTheDocument();
  expect(screen.getByText('SSKE-104929B')).toBeInTheDocument(); // the ref already carries its option letter
  expect(screen.getByText('C FAQ')).toBeInTheDocument();
  expect(screen.getByText('500 g')).toBeInTheDocument();
  expect(screen.getByText('approved')).toBeInTheDocument();
  expect(screen.getByText('rejected')).toBeInTheDocument();

  fireEvent.click(screen.getByText('fedex · 12'));
  expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ id: 'b-0', tab: 'bulk' }));
});

it('the child Date header flips the sends to oldest first', async () => {
  stubFetch();
  renderTable();
  await screen.findByText('CK Corporation');
  fireEvent.click(screen.getByRole('button', { name: 'Toggle sends to CK Corporation' }));
  await screen.findByText('dhl · 990');
  fireEvent.click(screen.getByRole('button', { name: /^Date/ }));
  const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
  expect(rows.findIndex((t) => t.includes('fedex · 12'))).toBeLessThan(rows.findIndex((t) => t.includes('CN-2001')));
});

it('a `client` filter (the deep link) is sent as the exact `client=` param, never `q=`, and opens the matched client', async () => {
  const spy = stubFetch();
  renderTable({ filters: { client: 'CK Corporation' } });
  // Expanded without a click: the row the exact match returned.
  expect(await screen.findByText('dhl · 990')).toBeInTheDocument();
  const listUrl = String(spy.mock.calls[0][0]);
  expect(listUrl).toContain('client=CK+Corporation');
  expect(listUrl).not.toMatch(/[?&]q=/);
  expect(spy.mock.calls.some(([u]) => /\/client-sends\/id%3Acl-1\?book=commercial$/.test(String(u)))).toBe(true);
  expect(spy.mock.calls.some(([u]) => /\/client-sends\/name%3Apaulig/.test(String(u)))).toBe(false);
  expect(screen.getByRole('button', { name: 'Toggle sends to CK Corporation' })).toHaveAttribute('aria-expanded', 'true');
});

it('free text goes to the server as the fuzzy `q=` and on its own opens nothing', async () => {
  const spy = stubFetch();
  renderTable({ filters: { q: 'Paulig' } });
  await screen.findByText('Paulig');
  const listUrl = String(spy.mock.calls[0][0]);
  expect(listUrl).toContain('q=Paulig');
  expect(listUrl).not.toMatch(/[?&]client=/);
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^Toggle sends to/ })).toHaveLength(2));
  expect(spy.mock.calls.some(([u]) => /\/client-sends\//.test(String(u)))).toBe(false);
  expect(screen.getByRole('button', { name: 'Toggle sends to CK Corporation' })).toHaveAttribute('aria-expanded', 'false');
});

it('free text and the client filter travel together, each under its own param', async () => {
  const spy = stubFetch();
  renderTable({ filters: { q: 'SSKE', client: 'CK Corporation' } });
  await screen.findByText('CK Corporation');
  const listUrl = String(spy.mock.calls[0][0]);
  expect(listUrl).toContain('q=SSKE');
  expect(listUrl).toContain('client=CK+Corporation');
});

it('an empty book says so in clients, singular', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ data: [CLIENTS[1]], total: 1, page: 1, pageSize: 50 }), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  renderTable({ book: 'specialty' });
  expect(await screen.findByText('1 client')).toBeInTheDocument();
});
