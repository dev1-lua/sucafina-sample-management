import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('../../lib/client-guard', async (orig) => ({
  ...(await orig<typeof import('../../lib/client-guard')>()),
  checkDeliverable: vi.fn(async () => ({ client_id: 'client-1', client: { id: 'client-1', name: 'EDMAX', country: 'Kenya', contacts: [] }, internal: false, client_created: false, details_missing: [], details_optional: [] })),
  lastPssQty: vi.fn(async () => null),
}));
vi.mock('../../lib/notify', async (orig) => ({
  ...(await orig<typeof import('../../lib/notify')>()),
  notifyContactGap: vi.fn(async () => null),
  touchRoster: vi.fn(async () => undefined),
}));
import { apiFetch } from '../../lib/api';
import CreateBulkSampleTool from './CreateBulkSampleTool';
import CreateSpecialtySampleTool from './CreateSpecialtySampleTool';

const api = apiFetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { api.mockReset(); });

const lot = { ref: 'TYPE-113', book: 'commercial', coffee_key: 'k', outturn: null, grade: null, quality: 'AB FAQ', blend: null, first_issued_at: '2026-06-01T00:00:00Z' };
const conflict409 = () =>
  Object.assign(new Error('Sample API error 409 on /bulk-samples'), {
    status: 409,
    body: { error: 'ref_conflict', ref: 'TYPE-113', lot, sends: [{ tab: 'bulk', id: 'b1', receiver: 'Joh Johanson', date_on: '2026-06-24', status: 'delivered' }] },
  });

describe('create_bulk_sample — refs name the coffee', () => {
  it('normalises the typed ref, passes consignment_id, surfaces lot_sends / reused_ref', async () => {
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/bulk-samples' && init?.method === 'POST') {
        return { id: 'b9', date: '2026-09-22', sample_ref: 'TYPE-113', quality: 'AB FAQ', client: 'EDMAX', client_id: 'client-1', sample_type_norm: 'type', qty_grams: 300, status: 'requested', lot_sends: 3, reused_ref: true };
      }
      throw new Error(`unexpected ${path}`);
    });
    const r: any = await new CreateBulkSampleTool().execute({ quality: 'AB FAQ', sample_type: 'type', client: 'EDMAX', sample_ref: 'type - 113', consignment_id: 'cn-uuid', client_id: 'client-1' });
    const body = JSON.parse((api.mock.calls.find((c) => c[0] === '/bulk-samples') as any)[1].body);
    expect(body).toMatchObject({ sample_ref: 'TYPE-113', consignment_id: 'cn-uuid' });
    expect(r).toMatchObject({ tab: 'bulk', id: 'b9', sample_ref: 'TYPE-113', lot_sends: 3, reused_ref: true });
  });

  it('409 ref_conflict → { ref_conflict, ref, lot, sends, say } instead of throwing; nothing else is written', async () => {
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/bulk-samples' && init?.method === 'POST') throw conflict409();
      throw new Error(`unexpected ${path}`);
    });
    const r: any = await new CreateBulkSampleTool().execute({ quality: 'C FAQ', sample_type: 'type', client: 'EDMAX', sample_ref: 'TYPE-113', client_id: 'client-1' });
    expect(r).toMatchObject({ ref_conflict: true, ref: 'TYPE-113', lot, created: false });
    expect(r.sends).toHaveLength(1);
    expect(r.say).toBe('TYPE-113 is AB FAQ (sent to Joh Johanson 24 Jun). This is C FAQ — a different coffee, so it gets a new ref. OK, or did you mean AB FAQ?');
  });

  it('any other API error still throws', async () => {
    api.mockImplementation(async () => { throw Object.assign(new Error('Sample API error 500'), { status: 500 }); });
    await expect(new CreateBulkSampleTool().execute({ quality: 'C FAQ', sample_type: 'type', client: 'EDMAX', client_id: 'client-1' })).rejects.toThrow('500');
  });
});

describe('create_specialty_sample — refs name the coffee', () => {
  it('normalises the typed ref, passes consignment_id, surfaces lot_sends / reused_ref', async () => {
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/specialty-samples' && init?.method === 'POST') {
        return { id: 's9', ref: 'SL-7336', date: '2026-09-22', description: 'AA', receiver_company: 'TORCH', client_id: 'client-1', sample_type_norm: 'offer', status: 'requested', lot_sends: 3, reused_ref: true };
      }
      throw new Error(`unexpected ${path}`);
    });
    const r: any = await new CreateSpecialtySampleTool().execute({ description: 'AA', sample_type: 'offer', receiver_company: 'TORCH', name: 'Sangalai', country: 'Kenya', ref: 'sl 7336', outturn: '17KN0076', grade: 'AA', consignment_id: 'cn-uuid', client_id: 'client-1' });
    const body = JSON.parse((api.mock.calls.find((c) => c[0] === '/specialty-samples') as any)[1].body);
    expect(body).toMatchObject({ ref: 'SL-7336', consignment_id: 'cn-uuid' });
    expect(r).toMatchObject({ tab: 'specialty', id: 's9', ref: 'SL-7336', lot_sends: 3, reused_ref: true });
  });

  it('409 ref_conflict → ref_conflict result with the say line', async () => {
    const specialtyLot = { ...lot, ref: 'SL-7336', book: 'specialty', outturn: '17KN0076', grade: 'AA', quality: null };
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/specialty-samples' && init?.method === 'POST') {
        throw Object.assign(new Error('409'), { status: 409, body: { error: 'ref_conflict', ref: 'SL-7336', lot: specialtyLot, sends: [{ tab: 'specialty', id: 's1', receiver: 'TORCH', date_on: '2026-06-04', status: 'delivered' }] } });
      }
      throw new Error(`unexpected ${path}`);
    });
    const r: any = await new CreateSpecialtySampleTool().execute({ description: 'AB', sample_type: 'offer', receiver_company: 'TORCH', name: 'Sangalai', country: 'Kenya', ref: 'SL-7336', outturn: '17KN0099', grade: 'AB', client_id: 'client-1' });
    expect(r).toMatchObject({ ref_conflict: true, ref: 'SL-7336', created: false });
    expect(r.say).toBe('SL-7336 is 17KN0076 AA (sent to TORCH 4 Jun). This is 17KN0099 AB — a different coffee, so it gets a new ref. OK, or did you mean 17KN0076 AA?');
  });
});
