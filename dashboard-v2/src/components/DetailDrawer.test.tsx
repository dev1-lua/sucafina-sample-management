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

// --- Round 11: the send id under the title; the ref is QC-editable and a 409 says why inline. ------
const REF_FIELDS: DetailField[] = [
  { key: 'ref', label: 'Ref', edit: { field: 'ref', type: 'text' } },
  { key: 'status', label: 'Status', edit: { field: 'status', type: 'text' } },
];
const CONFLICT = {
  error: 'ref_conflict', ref: 'TYPE-115',
  lot: { ref: 'TYPE-115', book: 'commercial', coffee_key: 'k', outturn: null, grade: null, quality: 'AB FAQ', blend: null, first_issued_at: '2026-06-01T00:00:00Z' },
  sends: [],
  message: 'TYPE-115 is AB FAQ (3 sends). This row is C FAQ — a different coffee. Give it a new ref, or correct the outturn/grade first.',
};

/** GET serves the row; a PATCH of `ref` answers 409 with the conflict body, any other PATCH sticks. */
function stubRefPatch(row: Record<string, unknown>, conflict: Record<string, unknown> | null = CONFLICT) {
  let current = row;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init as RequestInit | undefined)?.method ?? 'GET';
    const json = { status: 200, headers: { 'content-type': 'application/json' } };
    if (url.includes('/traders')) return new Response(JSON.stringify({ data: [], total: 0 }), json);
    if (method === 'PATCH') {
      const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      if ('ref' in body && conflict) return new Response(JSON.stringify(conflict), { status: 409, headers: json.headers });
      current = { ...current, ...body };
    }
    return new Response(JSON.stringify(current), json);
  });
}

it('shows "Send ID SS-<n>" under the title, in monospace, when the row carries one', async () => {
  stubRefPatch({ ...detail, send_id: 'SS-1042' });
  render(wrap(<DetailDrawer endpoint="/specialty-samples" id="1" open onClose={() => {}} fields={fields} />));
  expect(await screen.findByText('REF-001')).toBeInTheDocument();
  expect(screen.getByText(/^Send ID/)).toBeInTheDocument();
  expect(screen.getByText('SS-1042')).toHaveClass('font-mono');
});

it('no Send ID line for a row that predates the column', async () => {
  stubRefPatch(detail);
  render(wrap(<DetailDrawer endpoint="/specialty-samples" id="1" open onClose={() => {}} fields={fields} />));
  expect(await screen.findByText('REF-001')).toBeInTheDocument();
  expect(screen.queryByText(/^Send ID/)).not.toBeInTheDocument();
});

it('the ref is an editable detail field: committing a new value PATCHes {ref} and the title follows', async () => {
  const spy = stubRefPatch(detail, null);
  render(wrap(<DetailDrawer endpoint="/specialty-samples" id="1" open onClose={() => {}} fields={REF_FIELDS} />));
  const input = await screen.findByDisplayValue('REF-001');
  fireEvent.change(input, { target: { value: 'TYPE-116' } });
  fireEvent.blur(input);
  await waitFor(() => {
    const patch = spy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
    expect(patch).toBeTruthy();
    expect(String(patch![0])).toMatch(/\/specialty-samples\/1$/);
    expect(JSON.parse(String((patch![1] as RequestInit).body))).toEqual({ ref: 'TYPE-116' });
  });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'TYPE-116' })).toBeInTheDocument());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('a 409 ref_conflict shows the server message under the Ref field and rolls the value back', async () => {
  stubRefPatch(detail);
  render(wrap(<DetailDrawer endpoint="/bulk-samples" id="1" open onClose={() => {}} fields={REF_FIELDS} />));
  const input = await screen.findByDisplayValue('REF-001');
  fireEvent.change(input, { target: { value: 'TYPE-115' } });
  fireEvent.blur(input);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('TYPE-115 is AB FAQ (3 sends). This row is C FAQ — a different coffee.');
  // The message sits in the Ref field's row, not somewhere generic.
  expect(alert.closest('dd')?.querySelector('input')).toHaveDisplayValue('REF-001');
  // Editing again clears the stale message.
  fireEvent.change(screen.getByDisplayValue('REF-001'), { target: { value: 'TYPE-117' } });
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument()); // the second 409
  expect(screen.getAllByRole('alert')).toHaveLength(1);
});

it('a 409 without a message still explains the clash; any other failure gets a generic line', async () => {
  stubRefPatch(detail, { error: 'ref_conflict', ref: 'TYPE-115', lot: { ref: 'TYPE-115', quality: 'AB FAQ', blend: 'Blend' }, sends: [] });
  const { unmount } = render(wrap(<DetailDrawer endpoint="/bulk-samples" id="1" open onClose={() => {}} fields={REF_FIELDS} />));
  const input = await screen.findByDisplayValue('REF-001');
  fireEvent.change(input, { target: { value: 'TYPE-115' } });
  fireEvent.blur(input);
  expect(await screen.findByRole('alert')).toHaveTextContent('TYPE-115 already names a different coffee (AB FAQ Blend).');
  unmount();
  vi.restoreAllMocks();

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const method = (init as RequestInit | undefined)?.method ?? 'GET';
    if (String(input).includes('/traders')) return new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 });
    if (method === 'PATCH') return new Response('boom', { status: 500 });
    return new Response(JSON.stringify(detail), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  render(wrap(<DetailDrawer endpoint="/specialty-samples" id="1" open onClose={() => {}} fields={REF_FIELDS} />));
  const status = await screen.findByDisplayValue('requested');
  fireEvent.change(status, { target: { value: 'dispatched' } });
  fireEvent.blur(status);
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save this change. Please try again.');
});

it('a field hint renders muted under the value or input, and only for fields that carry one', async () => {
  stubFetch();
  const HINT = 'Names the coffee — shared by every send of it. Change it only if the coffee was mislabelled.';
  const fieldsWithHint: DetailField[] = [
    { key: 'ref', label: 'Ref', edit: { field: 'ref', type: 'text' }, hint: HINT },
    { key: 'status', label: 'Status', edit: { field: 'status', type: 'text' } },
  ];
  render(wrap(<DetailDrawer endpoint="/specialty-samples" id="1" open onClose={() => {}} fields={fieldsWithHint} />));
  const input = await screen.findByDisplayValue('REF-001');
  const hint = screen.getByText(HINT);
  expect(hint).toHaveClass('text-xs', 'text-muted-foreground');
  expect(hint).not.toHaveAttribute('role', 'alert');
  // Under the Ref input, inside the same definition cell — not the Status one.
  expect(input.closest('dd')).toContainElement(hint);
  expect(screen.getByDisplayValue('requested').closest('dd')).not.toContainElement(hint);
});

it('In the loop: no account-manager line when neither the row nor a client carries one', async () => {
  stubRound10({ ...RESEND, notify_trader_ids: [] });
  render(wrap(<DetailDrawer endpoint="/forwarding-samples" id="u-2" open onClose={() => {}} fields={fields} />));
  expect(await screen.findByText('In the loop')).toBeInTheDocument();
  expect(screen.queryByText(/Account manager:/)).not.toBeInTheDocument();
});
