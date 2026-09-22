import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../lib/api';
import RecordDispatchTool from './RecordDispatchTool';

const api = apiFetch as unknown as ReturnType<typeof vi.fn>;
const calls = () => api.mock.calls.map((c) => [c[0], c[1]?.method ?? 'GET', c[1]?.body ? JSON.parse(c[1].body) : undefined]);

beforeEach(() => { api.mockReset(); });

describe('record_dispatch — items by ref, or a whole order by CN', () => {
  it('a {ref, receiver} item is resolved through /samples/resolve, then patched like a {tab,id} item', async () => {
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith('/samples/resolve')) {
        return { ref: 'SL-7336', candidates: [{ tab: 'specialty', id: 'row-1', ref: 'SL-7336', receiver: 'TORCH', status: 'preparing', date_on: '2026-06-04' }] };
      }
      if (path === '/specialty-samples/row-1' && init?.method === 'PATCH') return { id: 'row-1', ref: 'SL-7336', status: 'dispatched', courier_norm: 'dhl', awb: '1234', client_id: null };
      throw new Error(`unexpected ${path}`);
    });
    const r: any = await new RecordDispatchTool().execute({ items: [{ ref: 'sl 7336', receiver: 'torch' }], courier: 'DHL', awb: '12-34' });
    expect(calls()[0]![0]).toBe('/samples/resolve?ref=SL-7336&receiver=torch');
    expect(calls()[1]).toEqual(['/specialty-samples/row-1', 'PATCH', expect.objectContaining({ status: 'dispatched', courier_norm: 'dhl', awb: '1234' })]);
    expect(r.updated).toHaveLength(1);
    expect(r.updated[0]).toMatchObject({ tab: 'specialty', id: 'row-1', ref: 'SL-7336', status: 'dispatched' });
  });

  it('consignment: "CN-1012" → POST /consignments/:id/dispatch with courier + awb, reporting the count', async () => {
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.startsWith("/consignments?q=CN-1012")) return { data: [{ id: 'cn-uuid', number: 'CN-1012' }] };
      if (path === '/consignments/cn-uuid/dispatch' && init?.method === 'POST') return { updated: 3 };
      throw new Error(`unexpected ${path}`);
    });
    const r: any = await new RecordDispatchTool().execute({ consignment: "CN-1012", courier: 'fedex', awb: '7788', dispatched_on: '2026-09-22' });
    expect(calls()[1]).toEqual(['/consignments/cn-uuid/dispatch', 'POST', { courier: 'fedex', awb: '7788', dispatched_on: '2026-09-22' }]);
    expect(r).toMatchObject({ consignment: 'CN-1012', updated: 3 });
    expect(r.url).toContain('/consignments/cn-uuid');
  });

  it('an unknown consignment is reported, nothing is written', async () => {
    api.mockResolvedValueOnce({ data: [] });
    const r = await new RecordDispatchTool().execute({ consignment: 'CN-9999', courier: 'dhl' });
    expect(r).toMatchObject({ found: false });
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('neither items nor consignment is rejected by the schema', () => {
    expect(new RecordDispatchTool().inputSchema.safeParse({ courier: 'dhl' }).success).toBe(false);
  });
});
