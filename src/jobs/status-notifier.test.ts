import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('../lib/notify', async (orig) => ({
  ...(await orig<typeof import('../lib/notify')>()),
  loadTraders: vi.fn(),
  sendToPerson: vi.fn(),
}));
import { apiFetch } from '../lib/api';
import { loadTraders, NOTIFY_CC, sendToPerson } from '../lib/notify';
import { courierLabel, groupCreated, qcMessage, qcOrderMessage, statusNotifierJob, traderMessage } from './status-notifier.job';
import type { OutboxItem } from '../lib/change-alerts';

const api = apiFetch as unknown as ReturnType<typeof vi.fn>;
const traders = loadTraders as unknown as ReturnType<typeof vi.fn>;
const send = sendToPerson as unknown as ReturnType<typeof vi.fn>;

const item = (o: Partial<OutboxItem>): OutboxItem =>
  ({
    outbox_id: 'o1', tab: 'specialty', sample_id: 's1', event: 'awb_added', recipient: null,
    ref: 'SL-7461', title: 'AB FAQ', receiver: 'Baba Coffee', status: 'preparing',
    courier_norm: 'dhl', awb: '1234567890', qty_grams: 300, priority: 'normal',
    requested_by: 'Ivo', logged_by: 'Ivo', client_name: 'Baba Coffee', created_at: '2026-09-14T09:00:00Z',
    recipients: [], awaiting_collection: true,
    ...o,
  }) as OutboxItem;

// Three coffees to EDMAX in one request — one order.
const created = (o: Partial<OutboxItem>): OutboxItem =>
  item({
    event: 'created', tab: 'bulk', status: 'requested', courier_norm: null, awb: null, awaiting_collection: false,
    client_name: 'EDMAX', receiver: 'EDMAX', requested_by: 'Ivo', logged_by: 'Gloria',
    client_email: 'jane@edmax.co.ke', client_contact: 'Jane', client_phone: '+254 700 000000', client_created_at: '2026-01-05T08:00:00Z',
    country: 'Kenya', sample_type_norm: 'type', consignment_id: 'cn-uuid', consignment_number: 'CN-1012', lot_sends: 1,
    payload: { consignment_id: 'cn-uuid', consignment_number: 'CN-1012' },
    ...o,
  });
const ORDER = [
  created({ outbox_id: 'o1', sample_id: 'b1', ref: 'TYPE-980', title: 'AB FAQ', qty_grams: 300 }),
  created({ outbox_id: 'o2', sample_id: 'b2', ref: 'TYPE-981', title: 'ABC FAQ', qty_grams: 300 }),
  created({ outbox_id: 'o3', sample_id: 'b3', ref: 'TYPE-982', title: 'Heavy Mbuni', qty_grams: 500, priority: 'urgent' }),
];

describe('traderMessage — the sketch wording', () => {
  it('AWB added: names the sample, the client and the courier, and says it is on its way soon', () => {
    const { text, subject } = traderMessage(item({}));
    expect(text).toBe('Your sample SL-7461 (AB FAQ) for Baba Coffee has a DHL AWB 1234567890 — it\'ll be on its way soon.');
    expect(subject).toBe('Sample SL-7461: AWB added');
  });

  it('AWB added falls back to the receiver when the row has no client book entry', () => {
    const { text } = traderMessage(item({ client_name: null, receiver: 'Walk-in Roasters' }));
    expect(text).toContain('for Walk-in Roasters has a DHL AWB');
  });

  it('AWB typed after the dispatch never says "soon" — the parcel already left', () => {
    const { text } = traderMessage(item({ status: 'dispatched', awaiting_collection: false }));
    expect(text).toBe('SL-7461 (AB FAQ) for Baba Coffee is on its way — DHL AWB 1234567890.');
  });

  it('dispatched: on its way with courier and AWB', () => {
    const { text, subject } = traderMessage(item({ event: 'dispatched', status: 'dispatched', courier_norm: 'fedex', awb: '7788' }));
    expect(text).toBe('SL-7461 (AB FAQ) for Baba Coffee is on its way — FedEx AWB 7788.');
    expect(subject).toBe('Sample SL-7461: dispatched');
  });

  it('dispatched without an AWB says so instead of inventing one', () => {
    const { text } = traderMessage(item({ event: 'dispatched', status: 'dispatched', courier_norm: 'rider', awb: null }));
    expect(text).toBe('SL-7461 (AB FAQ) for Baba Coffee is on its way — rider, no AWB yet.');
  });

  it('preparing wording is unchanged', () => {
    const { text } = traderMessage(item({ event: 'preparing', status: 'preparing' }));
    expect(text).toBe('Your sample SL-7461 (AB FAQ → Baba Coffee) is being prepared by the lab.');
  });
});

describe('courierLabel', () => {
  it('spells every normalised courier the desk uses', () => {
    expect(['dhl', 'fedex', 'ups', 'rider', 'hand_delivery', 'client_pickup', 'wells_fargo', null].map(courierLabel))
      .toEqual(['DHL', 'FedEx', 'UPS', 'rider', 'hand delivery', 'client pickup', 'Wells Fargo', 'courier']);
  });
});

describe('groupCreated — one request to one client = one QC ping', () => {
  it('groups pending created rows by consignment', () => {
    const groups = groupCreated(ORDER);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((i) => i.ref)).toEqual(['TYPE-980', 'TYPE-981', 'TYPE-982']);
  });

  it('different consignments are different groups; the fallback key is logged_by + client', () => {
    const rows = [
      ...ORDER,
      created({ outbox_id: 'o4', ref: 'TYPE-990', consignment_id: 'cn-2', consignment_number: 'CN-1013', payload: { consignment_id: 'cn-2', consignment_number: 'CN-1013' } }),
      created({ outbox_id: 'o5', ref: 'SL-8000', consignment_id: null, consignment_number: null, payload: {}, client_name: 'Beyers', logged_by: 'Gloria' }),
      created({ outbox_id: 'o6', ref: 'SL-8001', consignment_id: null, consignment_number: null, payload: {}, client_name: 'Beyers', logged_by: 'Gloria' }),
      created({ outbox_id: 'o7', ref: 'SL-8002', consignment_id: null, consignment_number: null, payload: {}, client_name: 'Beyers', logged_by: 'Ivo' }),
    ];
    const groups = groupCreated(rows);
    expect(groups.map((g) => g.map((i) => i.ref))).toEqual([
      ['TYPE-980', 'TYPE-981', 'TYPE-982'], ['TYPE-990'], ['SL-8000', 'SL-8001'], ['SL-8002'],
    ]);
  });

  it('a created row with no consignment and no client is never grouped with another', () => {
    const rows = [
      created({ outbox_id: 'a', ref: 'SL-1', consignment_id: null, consignment_number: null, payload: {}, client_name: null, client_id: null }),
      created({ outbox_id: 'b', ref: 'SL-2', consignment_id: null, consignment_number: null, payload: {}, client_name: null, client_id: null }),
    ];
    expect(groupCreated(rows).map((g) => g.length)).toEqual([1, 1]);
  });
});

describe('qcOrderMessage — the grouped "new order" ping', () => {
  const now = new Date('2026-09-22T06:00:00Z');

  it('header, one line per sample, people, client, type, link; subject carries the count', () => {
    const { text, subject } = qcOrderMessage(ORDER, { now });
    expect(text.split('\n')).toEqual([
      'New order CN-1012 for EDMAX 🔴 URGENT — 3 samples:',
      '- TYPE-980 — AB FAQ • → EDMAX • 300g • Commercial',
      '- TYPE-981 — ABC FAQ • → EDMAX • 300g • Commercial',
      '- TYPE-982 — Heavy Mbuni • → EDMAX • 500g • Commercial 🔴',
      '- logged by Gloria for Ivo',
      '- Client: EDMAX — Jane · jane@edmax.co.ke · +254 700 000000',
      '- Type: type · Country: Kenya',
      '- https://sucafina-sample-management.vercel.app/bulk?consignment=CN-1012',
    ]);
    expect(subject).toBe('New sample request (3) (URGENT): CN-1012 · EDMAX');
  });

  it('NEW CLIENT flag from payload.client_created, and from a client row created today (Nairobi)', () => {
    const viaPayload = qcOrderMessage(ORDER.map((i) => ({ ...i, priority: 'normal', payload: { ...i.payload, client_created: true } })), { now });
    expect(viaPayload.text).toContain('- 🆕 NEW CLIENT (added today) Client: EDMAX — Jane · jane@edmax.co.ke · +254 700 000000');
    expect(viaPayload.subject).toBe('New sample request (3): CN-1012 · EDMAX');
    // Nairobi is UTC+3: a client created 21:30Z (00:30 on the 23rd) is "today" for a run at 22:10Z (01:10 on the 23rd)…
    const viaDate = qcOrderMessage(ORDER.map((i) => ({ ...i, client_created_at: '2026-09-22T21:30:00Z' })), { now: new Date('2026-09-22T22:10:00Z') });
    expect(viaDate.text).toContain('🆕 NEW CLIENT (added today)');
    // …but one created 20:30Z (23:30 on the 22nd) is yesterday's, even though the UTC date matches.
    const yesterday = qcOrderMessage(ORDER.map((i) => ({ ...i, client_created_at: '2026-09-22T20:30:00Z' })), { now: new Date('2026-09-22T22:10:00Z') });
    expect(yesterday.text).not.toContain('NEW CLIENT');
    const old = qcOrderMessage(ORDER, { now });
    expect(old.text).not.toContain('NEW CLIENT');
  });

  it('missing client details print as placeholders, the address gap line stays, no link without a CN', () => {
    const rows = ORDER.map((i) => ({
      ...i, priority: 'normal', client_email: null, client_contact: null, client_phone: null, client_address_missing: true,
      consignment_id: null, consignment_number: null, payload: {},
    }));
    const { text, subject } = qcOrderMessage(rows, { now });
    expect(text).toContain('New sample request (3) for EDMAX — 3 samples:');
    expect(text).toContain('- Client: EDMAX — — · no email on file · —');
    expect(text).toContain('- ⚠ No delivery address on file for EDMAX — nobody asked yet');
    expect(text).not.toContain('vercel.app');
    expect(subject).toBe('New sample request (3): EDMAX — address pending');
  });
});

describe('qcMessage — a single sample keeps today\'s text plus the client / type lines', () => {
  it('adds the client and type lines after the people line', () => {
    const { text, subject } = qcMessage(ORDER[0]!, { now: new Date('2026-09-22T06:00:00Z') });
    expect(text.split('\n')).toEqual([
      'New sample request:',
      '- TYPE-980 — AB FAQ • → EDMAX • 300g • Commercial',
      '- logged by Gloria for Ivo',
      '- Client: EDMAX — Jane · jane@edmax.co.ke · +254 700 000000',
      '- Type: type · Country: Kenya',
    ]);
    expect(subject).toBe('New sample request: TYPE-980');
  });

  it('flags a client added today', () => {
    const { text } = qcMessage({ ...ORDER[0]!, payload: { client_created: true } });
    expect(text).toContain('- 🆕 NEW CLIENT (added today) Client: EDMAX');
  });
});

describe('status-notifier run — grouped rows go out as ONE message, CC once, same mark on every row', () => {
  beforeEach(() => {
    api.mockReset();
    traders.mockReset();
    send.mockReset();
  });

  it('three created rows of one order → one send per QC member, both CCs on the first email only, three identical marks', async () => {
    const marks: any[] = [];
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/contracts/pss-sweep') return { ok: true };
      if (path === '/notifications/outbox-pending') return { items: ORDER };
      if (path === '/notifications/outbox-mark') { marks.push(JSON.parse(String(init?.body))); return { ok: true }; }
      throw new Error(`unexpected ${path}`);
    });
    traders.mockResolvedValue([
      { id: 'q1', name: 'Harriet', email: 'harriet@sucafina.com', role: 'qc', active: true },
      { id: 'q2', name: 'Bernard', email: 'bernard@sucafina.com', role: 'qc', active: true },
      { id: 't1', name: 'Ivo', email: 'ivo@sucafina.com', role: 'trader', active: true },
    ]);
    send.mockResolvedValue('email');

    const r = await statusNotifierJob.execute({} as any);
    expect(r).toMatchObject({ pending: 3, sent: 3, skipped: 0, failures: 0 });

    expect(send).toHaveBeenCalledTimes(2);
    const [first, second] = send.mock.calls.map((c) => c[0]);
    expect(first.subject).toBe('New sample request (3) (URGENT): CN-1012 · EDMAX');
    expect(first.text).toContain('New order CN-1012 for EDMAX');
    expect(first.cc).toEqual(NOTIFY_CC);
    expect(second.cc).toEqual([]);
    expect(second.text).toBe(first.text);

    expect(marks.map((m) => m.id)).toEqual(['o1', 'o2', 'o3']);
    expect(new Set(marks.map((m) => `${m.via}|${m.detail}`)).size).toBe(1);
    expect(marks[0].via).toBe('email');
    expect(marks[0].detail).toBe('Harriet (email), Bernard (email) · QC mailboxes copied');
  });
});
