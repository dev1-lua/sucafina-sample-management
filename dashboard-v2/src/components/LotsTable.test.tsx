import * as React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import { LotsTable } from './LotsTable';

// See RecordTable.test.tsx: the virtualizer needs a non-zero viewport under jsdom.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
});

// contracts.md §3 (list) and §2 (one lot with its sends).
const LOTS = [
  {
    ref: 'SL-7336', book: 'specialty', coffee_key: 'k1', outturn: '08KN0021', grade: 'AB', quality: 'KII/KIRINYAGA', blend: null,
    first_issued_at: '2026-05-01T00:00:00Z', sends: 3, open_sends: 1, delivered_sends: 2, last_send_on: '2026-06-10',
    last_receiver: 'Sucafina NV', status_rollup: '2 delivered · 1 pending',
  },
  {
    ref: 'SL-8001', book: 'specialty', coffee_key: 'k2', outturn: '13KP0215', grade: 'AA', quality: null, blend: null,
    first_issued_at: '2026-06-01T00:00:00Z', sends: 1, open_sends: 1, delivered_sends: 0, last_send_on: '2026-06-02',
    last_receiver: 'Paulig', status_rollup: '1 pending',
  },
];
const SENDS = {
  lot: LOTS[0],
  sends: [
    { tab: 'specialty', id: 'u-3', receiver: 'Sucafina NV', date_on: '2026-06-10', status: 'requested', qty_grams: 300, courier_norm: null, awb: null, title: 'KII AB', consignment_number: 'CN-1012' },
    { tab: 'specialty', id: 'u-2', receiver: 'Paulig', date_on: '2026-05-20', status: 'delivered', qty_grams: 500, courier_norm: 'dhl', awb: '778', title: 'KII AB', consignment_number: null },
    { tab: 'specialty', id: 'u-1', receiver: 'Beyers', date_on: '2026-05-02', status: 'delivered', qty_grams: 300, courier_norm: 'dhl', awb: '112', title: 'KII AB', consignment_number: null },
  ],
};

function stubFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const body = /\/lots\/[^?]/.test(url) ? SENDS : { data: LOTS, total: LOTS.length, page: 1, pageSize: 50 };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

function renderTable(props: Partial<React.ComponentProps<typeof LotsTable>> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LotsTable book="specialty" filters={{}} onSendClick={() => {}} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.restoreAllMocks());

it('lists one row per coffee from GET /lots?book= with its roll-up, last send and receiver', async () => {
  const spy = stubFetch();
  renderTable();
  expect(await screen.findByText('SL-7336')).toBeInTheDocument();
  expect(String(spy.mock.calls[0][0])).toMatch(/\/lots\?.*book=specialty/);
  expect(screen.getByText('08KN0021 · AB · KII/KIRINYAGA')).toBeInTheDocument();
  expect(screen.getByText('2 delivered · 1 pending')).toBeInTheDocument();
  expect(screen.getByText('Sucafina NV')).toBeInTheDocument();
  expect(screen.getByText('2 coffees')).toBeInTheDocument();
  // Nothing is fetched per lot until one is expanded.
  expect(spy.mock.calls.some(([u]) => /\/lots\/SL-7336/.test(String(u)))).toBe(false);
});

it('expanding a coffee fetches GET /lots/:ref and nests its sends newest first; a send click reports the send', async () => {
  const spy = stubFetch();
  const onSend = vi.fn();
  renderTable({ onSendClick: onSend });
  await screen.findByText('SL-7336');
  fireEvent.click(screen.getByRole('button', { name: 'Toggle sends of SL-7336' }));
  expect(await screen.findByText('Beyers')).toBeInTheDocument();
  expect(spy.mock.calls.some(([u]) => /\/lots\/SL-7336$/.test(String(u)))).toBe(true);
  const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
  const idx = (needle: string) => rows.findIndex((t) => t.includes(needle));
  expect(idx('Beyers')).toBeGreaterThan(idx('Paulig'));
  expect(idx('Paulig')).toBeGreaterThan(idx('SL-7336'));
  expect(idx('SL-8001')).toBeGreaterThan(idx('Beyers'));
  // Courier / AWB, qty, status badge and order ride on the child row.
  expect(screen.getByText('dhl · 778')).toBeInTheDocument();
  expect(screen.getByText('500 g')).toBeInTheDocument();
  expect(screen.getByText('CN-1012')).toBeInTheDocument();
  expect(screen.getAllByText('delivered').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByText('Beyers'));
  expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ id: 'u-1', tab: 'specialty' }));
});

it('the child Date header flips the sends to oldest first', async () => {
  stubFetch();
  renderTable({ initialExpandedRef: 'SL-7336' });
  // ?ref= on load: expanded without a click.
  expect(await screen.findByText('Beyers')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Date/ }));
  const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
  expect(rows.findIndex((t) => t.includes('Beyers'))).toBeLessThan(rows.findIndex((t) => t.includes('Paulig')));
});

it('a text filter goes to the server as q and the footer counts matches', async () => {
  const spy = stubFetch();
  renderTable({ filters: { q: 'Paulig' } });
  await screen.findByText('SL-7336');
  expect(String(spy.mock.calls[0][0])).toContain('q=Paulig');
  expect(screen.getByText('2 matches')).toBeInTheDocument();
});

it('a ref filter is sent as q too (the deep-link case)', async () => {
  const spy = stubFetch();
  renderTable({ book: 'commercial', filters: { ref: 'TYPE-113' } });
  await screen.findByText('SL-7336');
  expect(String(spy.mock.calls[0][0])).toMatch(/book=commercial/);
  expect(String(spy.mock.calls[0][0])).toContain('q=TYPE-113');
});

// --- Round 10b: PSS options group by contract (SSKE-<digits><letter> → one SSKE-<digits> lot) ---

const PSS_LOT = {
  ref: 'SSKE-104929', book: 'commercial', coffee_key: 'k-pss', outturn: null, grade: null, quality: 'AB FAQ', blend: null,
  first_issued_at: '2026-08-01T00:00:00Z', sends: 2, open_sends: 1, delivered_sends: 1, last_send_on: '2026-08-20',
  last_receiver: 'CK Corporation', status_rollup: '1 delivered · 1 pending', options: ['A', 'B'], contract_client: 'CK Corporation',
};
const PLAIN_LOT = {
  ref: 'TYPE-113', book: 'commercial', coffee_key: 'k-113', outturn: null, grade: null, quality: 'AB FAQ', blend: 'Blend',
  first_issued_at: '2026-07-01T00:00:00Z', sends: 1, open_sends: 1, delivered_sends: 0, last_send_on: '2026-07-02',
  last_receiver: 'Paulig', status_rollup: '1 pending', options: [], contract_client: null,
};
const PSS_SENDS = {
  lot: PSS_LOT,
  sends: [
    { tab: 'commercial', id: 'b-2', ref: 'SSKE-104929B', receiver: 'CK Corporation', date_on: '2026-08-20', status: 'requested', qty_grams: 300, courier_norm: null, awb: null, consignment_number: 'CN-2001', option_letter: 'B' },
    // A legacy row: option_letter unset, the letter comes from the send's own ref.
    { tab: 'commercial', id: 'b-1', ref: 'SSKE-104929A', receiver: 'CK Corporation', date_on: '2026-08-05', status: 'delivered', qty_grams: 300, courier_norm: 'dhl', awb: '990', consignment_number: null, option_letter: null },
  ],
};

function stubPssFetch() {
  const lots = [PSS_LOT, PLAIN_LOT];
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const body = /\/lots\/[^?]/.test(url) ? PSS_SENDS : { data: lots, total: lots.length, page: 1, pageSize: 50 };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

it('a PSS group row reads "<contract client> · options A, B" under its contract ref', async () => {
  stubPssFetch();
  renderTable({ book: 'commercial' });
  expect(await screen.findByText('SSKE-104929')).toBeInTheDocument();
  expect(screen.getByText('CK Corporation · options A, B')).toBeInTheDocument();
  // A non-PSS lot keeps the coffee label.
  expect(screen.getByText('AB FAQ · Blend')).toBeInTheDocument();
});

it('expanding a PSS group shows an Option header and the letters on the children in date order', async () => {
  stubPssFetch();
  renderTable({ book: 'commercial' });
  await screen.findByText('SSKE-104929');
  fireEvent.click(screen.getByRole('button', { name: 'Toggle sends of SSKE-104929' }));
  expect(await screen.findByText('dhl · 990')).toBeInTheDocument();
  expect(screen.getByText('Option')).toBeInTheDocument();
  const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
  const b = rows.findIndex((t) => t.includes('CN-2001'));
  const a = rows.findIndex((t) => t.includes('dhl · 990'));
  expect(b).toBeGreaterThan(-1);
  expect(a).toBeGreaterThan(b); // newest first: B (20 Aug) above A (5 Aug)
  expect(rows[b]!.startsWith('B')).toBe(true);
  expect(rows[a]!.startsWith('A')).toBe(true);
});

it('a non-PSS lot renders no Option cell', async () => {
  stubFetch();
  renderTable({ initialExpandedRef: 'SL-7336' });
  expect(await screen.findByText('Beyers')).toBeInTheDocument();
  expect(screen.queryByText('Option')).not.toBeInTheDocument();
});

it('?ref= with a lettered PSS ref opens and searches the contract group', async () => {
  const spy = stubPssFetch();
  renderTable({ book: 'commercial', filters: { ref: 'SSKE-104929A' }, initialExpandedRef: 'SSKE-104929A' });
  expect(await screen.findByText('dhl · 990')).toBeInTheDocument();
  expect(String(spy.mock.calls[0][0])).toContain('q=SSKE-104929');
  expect(String(spy.mock.calls[0][0])).not.toContain('q=SSKE-104929A');
  expect(spy.mock.calls.some(([u]) => /\/lots\/SSKE-104929$/.test(String(u)))).toBe(true);
  expect(spy.mock.calls.some(([u]) => /\/lots\/SSKE-104929A/.test(String(u)))).toBe(false);
});
