import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CreateRecordDialog } from './CreateRecordDialog';
import type { CreateFieldDef } from '@/types';

// A Commercial-book form cut down to the fields the lot logic touches: the typed ref, the
// coffee (quality · blend) and the shared request fields (client, country).
const BULK_FIELDS: CreateFieldDef[] = [
  { key: 'sample_ref', label: 'Ref', type: 'text' },
  { key: 'quality', label: 'Quality', type: 'text', required: true },
  { key: 'client', label: 'Client', type: 'text', required: true },
  { key: 'country', label: 'Country', type: 'text' },
  { key: 'blend', label: 'Blend', type: 'text' },
];

const LOT = { ref: 'TYPE-113', book: 'commercial', coffee_key: 'k', outturn: null, grade: null, quality: 'AB FAQ', blend: null, first_issued_at: '2026-09-01T00:00:00Z' };
const SENDS = [
  { tab: 'bulk', id: 'u-1', receiver: 'Joh Johanson', date_on: '2026-06-24', status: 'delivered', qty_grams: 300, courier_norm: 'dhl', awb: null },
  { tab: 'bulk', id: 'u-2', receiver: 'Paulig', date_on: '2026-05-01', status: 'delivered', qty_grams: 300, courier_norm: 'dhl', awb: null },
  { tab: 'bulk', id: 'u-3', receiver: 'Beyers', date_on: '2026-04-01', status: 'delivered', qty_grams: 300, courier_norm: 'dhl', awb: null },
];
const REUSE = { action: 'reuse', ref: 'TYPE-113', lot: LOT, sends: SENDS, reason: 'same coffee' };
const CONFLICT = { action: 'conflict', ref: 'TYPE-113', lot: LOT, sends: SENDS, reason: 'different coffee' };
const NEW = { action: 'new', ref: null, lot: null, sends: [], reason: 'not seen before' };

type Stub = { resolve?: unknown; create?: (n: number) => { status: number; body: unknown } };

function stubFetch({ resolve = NEW, create }: Stub = {}) {
  let creates = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    let status = 200;
    let body: unknown = {};
    if (url.endsWith('/lots/resolve')) body = resolve;
    else if (method === 'POST' && url.endsWith('/consignments')) body = { id: 'c-1', number: 'CN-1012', member_count: 2 };
    else if (method === 'POST') {
      creates += 1;
      const r = create ? create(creates) : { status: 201, body: { id: `new-${creates}`, client_id: 'cl-9' } };
      status = r.status;
      body = r.body;
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
}

function renderDialog(props: Partial<React.ComponentProps<typeof CreateRecordDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <CreateRecordDialog
        endpoint="/bulk-samples"
        entityLabel="Commercial Sample"
        fields={BULK_FIELDS}
        book="commercial"
        open
        onOpenChange={onOpenChange}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

const calls = (spy: ReturnType<typeof stubFetch>, pred: (url: string, method: string) => boolean) =>
  spy.mock.calls
    .filter(([u, init]) => pred(String(u), init?.method ?? 'GET'))
    .map(([, init]) => JSON.parse(String(init!.body)) as Record<string, unknown>);
const resolves = (spy: ReturnType<typeof stubFetch>) => calls(spy, (u, m) => m === 'POST' && u.endsWith('/lots/resolve'));
const creates = (spy: ReturnType<typeof stubFetch>) => calls(spy, (u, m) => m === 'POST' && u.endsWith('/bulk-samples'));
const orders = (spy: ReturnType<typeof stubFetch>) => calls(spy, (u, m) => m === 'POST' && u.endsWith('/consignments'));

afterEach(() => vi.restoreAllMocks());

describe('lot resolve notice (contracts §1)', () => {
  it('blurring a coffee field POSTs /lots/resolve with the book shape and shows the reuse notice', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ resolve: REUSE });
    renderDialog();
    await user.type(screen.getByLabelText(/quality/i), 'AB FAQ');
    await user.tab();
    await waitFor(() => expect(resolves(spy)).toHaveLength(1));
    expect(resolves(spy)[0]).toEqual({
      book: 'commercial', ref: null, outturn: null, grade: null, quality: 'AB FAQ', blend: null, sample_type: null,
    });
    expect(await screen.findByText('Same coffee as TYPE-113 (3 sends) — the ref will be reused')).toBeInTheDocument();
  });

  it('a typed ref that names another coffee shows the conflict notice and is dropped from the create', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({ resolve: CONFLICT });
    const { onOpenChange } = renderDialog();
    await user.type(screen.getByLabelText(/^ref/i), 'TYPE-113');
    await user.tab();
    expect(await screen.findByText('TYPE-113 already names AB FAQ — a new ref will be issued')).toBeInTheDocument();
    expect(resolves(spy)[0]).toMatchObject({ ref: 'TYPE-113' });

    await user.type(screen.getByLabelText(/quality/i), 'PB FAQ');
    await user.type(screen.getByLabelText(/client/i), 'EDMAX');
    await user.click(screen.getByRole('button', { name: /^create$/i }));
    await waitFor(() => expect(creates(spy)).toHaveLength(1));
    expect(creates(spy)[0]).toEqual({ quality: 'PB FAQ', client: 'EDMAX' });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('a 409 ref_conflict on create shows the notice and retries without the ref only after confirming', async () => {
    const user = userEvent.setup();
    const spy = stubFetch({
      create: (n) => (n === 1
        ? { status: 409, body: { error: 'ref_conflict', ref: 'TYPE-113', lot: LOT, sends: SENDS } }
        : { status: 201, body: { id: 'new-2', client_id: 'cl-9' } }),
    });
    const { onOpenChange } = renderDialog();
    await user.type(screen.getByLabelText(/quality/i), 'PB FAQ');
    await user.type(screen.getByLabelText(/client/i), 'EDMAX');
    // Type the ref last and submit straight away: no blur, so no pre-save resolve.
    fireEvent.change(screen.getByLabelText(/^ref/i), { target: { value: 'TYPE-113' } });
    fireEvent.submit(screen.getByRole('button', { name: /^create$/i }).closest('form')!);

    expect(await screen.findByText('TYPE-113 already names AB FAQ — a new ref will be issued')).toBeInTheDocument();
    expect(creates(spy)).toHaveLength(1);
    expect(creates(spy)[0]).toMatchObject({ sample_ref: 'TYPE-113' });
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /create with a new ref/i }));
    await waitFor(() => expect(creates(spy)).toHaveLength(2));
    expect(creates(spy)[1]).toEqual({ quality: 'PB FAQ', client: 'EDMAX' });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('does nothing lot-related outside the Specialty/Commercial books', async () => {
    const user = userEvent.setup();
    const spy = stubFetch();
    renderDialog({ book: undefined, endpoint: '/forwarding-samples' });
    await user.type(screen.getByLabelText(/quality/i), 'AB FAQ');
    await user.tab();
    expect(screen.queryByRole('button', { name: /add another coffee/i })).toBeNull();
    expect(resolves(spy)).toHaveLength(0);
  });
});

describe('several coffees for one client → one order (contracts §6)', () => {
  it('extra rows share the client fields, are created in turn, then grouped by POST /consignments', async () => {
    const user = userEvent.setup();
    const spy = stubFetch();
    const { onOpenChange } = renderDialog();
    await user.type(screen.getByLabelText(/quality/i), 'AB FAQ');
    await user.type(screen.getByLabelText(/client/i), 'EDMAX');
    await user.type(screen.getByLabelText(/country/i), 'Kenya');

    await user.click(screen.getByRole('button', { name: /add another coffee/i }));
    const row2 = screen.getByRole('group', { name: /coffee 2/i });
    // Per-coffee fields only — no second Client/Country input.
    expect(within(row2).queryByLabelText(/client/i)).toBeNull();
    await user.type(within(row2).getByLabelText(/quality/i), 'PB FAQ');
    await user.type(within(row2).getByLabelText(/blend/i), 'Nyeri');

    const group = screen.getByRole('checkbox', { name: /group as one order/i });
    expect(group).toBeChecked();

    await user.click(screen.getByRole('button', { name: /^create 2 samples$/i }));
    await waitFor(() => expect(creates(spy)).toHaveLength(2));
    expect(creates(spy)[0]).toEqual({ quality: 'AB FAQ', client: 'EDMAX', country: 'Kenya' });
    expect(creates(spy)[1]).toEqual({ quality: 'PB FAQ', client: 'EDMAX', country: 'Kenya', blend: 'Nyeri' });
    await waitFor(() => expect(orders(spy)).toHaveLength(1));
    expect(orders(spy)[0]).toEqual({
      client_id: 'cl-9',
      samples: [{ tab: 'bulk', id: 'new-1' }, { tab: 'bulk', id: 'new-2' }],
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('unticking "Group as one order" creates the rows without an order; a removed row is not created', async () => {
    const user = userEvent.setup();
    const spy = stubFetch();
    renderDialog();
    await user.type(screen.getByLabelText(/quality/i), 'AB FAQ');
    await user.type(screen.getByLabelText(/client/i), 'EDMAX');
    await user.click(screen.getByRole('button', { name: /add another coffee/i }));
    await user.click(screen.getByRole('button', { name: /add another coffee/i }));
    await user.type(within(screen.getByRole('group', { name: /coffee 2/i })).getByLabelText(/quality/i), 'PB FAQ');
    await user.type(within(screen.getByRole('group', { name: /coffee 3/i })).getByLabelText(/quality/i), 'C FAQ');
    await user.click(within(screen.getByRole('group', { name: /coffee 2/i })).getByRole('button', { name: /remove/i }));
    expect(screen.queryByRole('group', { name: /coffee 3/i })).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: /group as one order/i }));
    await user.click(screen.getByRole('button', { name: /^create 2 samples$/i }));
    await waitFor(() => expect(creates(spy)).toHaveLength(2));
    expect(creates(spy).map((b) => b.quality)).toEqual(['AB FAQ', 'C FAQ']);
    expect(orders(spy)).toHaveLength(0);
  });

  it('caps the repeater at 10 coffees', async () => {
    const user = userEvent.setup();
    stubFetch();
    renderDialog();
    const add = screen.getByRole('button', { name: /add another coffee/i });
    for (let i = 0; i < 9; i += 1) await user.click(add);
    expect(screen.getByRole('group', { name: /coffee 10/i })).toBeInTheDocument();
    expect(add).toBeDisabled();
  });
});
