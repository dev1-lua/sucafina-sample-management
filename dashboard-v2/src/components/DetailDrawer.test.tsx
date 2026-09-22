import * as React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

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
    // The details tab's loop-in section reads the roster on every sample; an empty one is fine here.
    if (String(_url).includes('/traders')) return new Response(JSON.stringify({ data: [], total: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
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

it('date edit field shows YYYY-MM-DD from an ISO timestamp and PATCHes the picked date (feedback #35)', async () => {
  const dateFields: DetailField[] = [
    { key: 'dispatched_on', label: 'Dispatched On', edit: { field: 'dispatched_on', type: 'date' } },
  ];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const method = (init as RequestInit | undefined)?.method ?? 'GET';
    if (String(_url).includes('/traders')) return new Response(JSON.stringify({ data: [], total: 0 }), { status: 200, headers: { 'content-type': 'application/json' } });
    const row = { ...detail, dispatched_on: '2026-08-20T00:00:00.000Z' };
    const body = method === 'PATCH' ? { ...row, ...JSON.parse(String((init as RequestInit).body)) } : row;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  render(wrap(<DetailDrawer endpoint="/specialty-samples" id="1" open onClose={() => {}} fields={dateFields} />));
  const input = (await screen.findByDisplayValue('2026-08-20')) as HTMLInputElement;
  expect(input.type).toBe('date');
  fireEvent.change(input, { target: { value: '2026-08-18' } });
  fireEvent.blur(input);
  await waitFor(() => {
    const patch = spy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    expect(patch).toBeTruthy();
    expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({ dispatched_on: '2026-08-18' });
  });
});

it('Related tab: a once-sent coffee outside any order says so plainly', async () => {
  const user = userEvent.setup();
  stubFetch();
  render(wrap(<DetailDrawer endpoint="/specialty-samples" id="1" open onClose={() => {}} fields={fields} />));
  await waitFor(() => expect(screen.getByText('REF-001')).toBeInTheDocument());
  expect(screen.queryByText(/Re-send/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: /related/i }));
  expect(screen.getByText('No other sends of this coffee.')).toBeInTheDocument();
  expect(screen.getByText('Not part of an order.')).toBeInTheDocument();
});

// --- Round 10: the ref names the coffee; the drawer shows its other sends and its order. ------
const RESEND = {
  id: 'u-2', ref: 'SL-7336', status: 'delivered', receiver_company: 'Paulig', lot_sends: 3,
  consignment_id: 'c-1', consignment_number: 'CN-1012', events: [],
};
const LOT = {
  lot: { ref: 'SL-7336', book: 'specialty' },
  sends: [
    { tab: 'specialty', id: 'u-3', receiver: 'Sucafina NV', date_on: '2026-06-10', status: 'requested', qty_grams: 300, courier_norm: null, awb: null, consignment_number: null },
    { tab: 'specialty', id: 'u-2', receiver: 'Paulig', date_on: '2026-05-20', status: 'delivered', qty_grams: 500, courier_norm: 'dhl', awb: '778', consignment_number: 'CN-1012' },
    { tab: 'specialty', id: 'u-1', receiver: 'Beyers', date_on: '2026-05-02', status: 'delivered', qty_grams: 300, courier_norm: 'fedex', awb: '112', consignment_number: null },
  ],
};
const ORDER = {
  id: 'c-1', number: 'CN-1012', status: 'open', client_name: 'Paulig', derived_status: 'partly_dispatched', member_count: 2, events: [],
  members: [
    { tab: 'specialty', id: 'u-2', ref: 'SL-7336', title: 'KII AB', receiver: 'Paulig', status: 'delivered' },
    { tab: 'bulk', id: 'u-7', ref: 'TYPE-113', title: 'AB FAQ', receiver: 'Paulig', status: 'requested' },
  ],
};
const CLIENT = { id: 'cl-1', name: 'Paulig', country: 'FI', account_owner_id: 't-2', account_owner: { id: 't-2', name: 'Gloria', role: 'trader', email: null }, contacts: [], orders: [], events: [] };
const ROSTER = [
  { id: 'id-ivo', name: 'Ivo', email: 'ivo@sucafina.com', role: 'trader', active: true },
  { id: 'id-harriet', name: 'Harriet', email: null, role: 'qc', active: true },
  { id: 'id-ghost', name: 'Ghost', email: null, role: 'trader', active: false },
];

// A PATCH sticks (the drawer refetches after each one), like the real API.
function stubRound10(row: Record<string, unknown> = RESEND) {
  let current = row;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init as RequestInit | undefined)?.method ?? 'GET';
    let body: unknown = current;
    if (url.includes('/lots/')) body = LOT;
    else if (url.includes('/consignments/')) body = ORDER;
    else if (url.includes('/traders')) body = { data: ROSTER, total: ROSTER.length };
    else if (url.includes('/clients/')) body = CLIENT;
    else if (method === 'PATCH') body = current = { ...current, ...JSON.parse(String((init as RequestInit).body)) };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

function Location() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

it('re-send banner names the ordinal and jumps to Related, which lists the other sends and the order', async () => {
  const user = userEvent.setup();
  stubRound10();
  render(
    wrap(
      <>
        <DetailDrawer endpoint="/specialty-samples" id="u-2" open onClose={() => {}} fields={fields} />
        <Location />
      </>,
    ),
  );
  // u-2 is the 2nd of the three sends by date.
  expect(await screen.findByText(/Re-send · 2nd send of this coffee/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'see all' }));
  expect(screen.getByRole('tab', { name: /related/i })).toHaveAttribute('aria-selected', 'true');

  expect(await screen.findByText('Other sends of SL-7336')).toBeInTheDocument();
  expect(screen.getByText('Sucafina NV')).toBeInTheDocument();
  expect(screen.getByText('Beyers')).toBeInTheDocument();
  expect(screen.getByText('fedex · 112')).toBeInTheDocument();
  // The current row is excluded from "other sends".
  expect(screen.queryByText('Paulig', { selector: '[data-send] *' })).not.toBeInTheDocument();

  expect(screen.getByText('Order CN-1012')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /open order/i })).toHaveAttribute('href', '/consignments/c-1');
  expect(screen.getByText('TYPE-113')).toBeInTheDocument();
  expect(screen.getByText(/AB FAQ → Paulig/)).toBeInTheDocument();

  // Clicking another send opens that row's drawer.
  await user.click(screen.getByText('Beyers'));
  expect(screen.getByTestId('path').textContent).toBe('/samples/u-1');
});

it('In the loop: chips from notify_trader_ids, add from the active roster, remove — each a full-array PATCH', async () => {
  const user = userEvent.setup();
  const spy = stubRound10({ ...RESEND, notify_trader_ids: ['id-ivo'], account_owner: { id: 't-1', name: 'Muki' } });
  render(wrap(<DetailDrawer endpoint="/specialty-samples" id="u-2" open onClose={() => {}} fields={fields} />));
  expect(await screen.findByText('In the loop')).toBeInTheDocument();
  expect(await screen.findByText('Ivo')).toBeInTheDocument();
  expect(screen.getByText('Account manager: Muki')).toBeInTheDocument();

  const add = screen.getByRole('combobox', { name: 'Add to the loop' });
  const options = Array.from((add as HTMLSelectElement).options).map((o) => o.textContent);
  expect(options).toContain('Harriet');
  expect(options).not.toContain('Ivo'); // already listed
  expect(options).not.toContain('Ghost'); // inactive
  await user.selectOptions(add, 'id-harriet');
  await waitFor(() => {
    const patches = spy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    expect(JSON.parse(String((patches.at(-1)![1] as RequestInit).body))).toEqual({ notify_trader_ids: ['id-ivo', 'id-harriet'] });
  });

  await user.click(screen.getByRole('button', { name: 'Remove Ivo from the loop' }));
  await waitFor(() => {
    const patches = spy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    expect(JSON.parse(String((patches.at(-1)![1] as RequestInit).body))).toEqual({ notify_trader_ids: ['id-harriet'] });
  });
});

it('In the loop: the account manager comes from the client record when the row only carries client_id', async () => {
  const spy = stubRound10({ ...RESEND, notify_trader_ids: [], client_id: 'cl-1' });
  render(wrap(<DetailDrawer endpoint="/bulk-samples" id="u-2" open onClose={() => {}} fields={fields} />));
  expect(await screen.findByText('Account manager: Gloria')).toBeInTheDocument();
  expect(spy.mock.calls.some(([input]) => String(input).includes('/clients/cl-1'))).toBe(true);
});

it('In the loop: no account-manager line when neither the row nor a client carries one', async () => {
  stubRound10({ ...RESEND, notify_trader_ids: [] });
  render(wrap(<DetailDrawer endpoint="/forwarding-samples" id="u-2" open onClose={() => {}} fields={fields} />));
  expect(await screen.findByText('In the loop')).toBeInTheDocument();
  expect(screen.queryByText(/Account manager:/)).not.toBeInTheDocument();
});
