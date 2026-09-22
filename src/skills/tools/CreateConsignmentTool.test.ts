import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../lib/api';
import CreateConsignmentTool from './CreateConsignmentTool';

const api = apiFetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { api.mockReset(); });

describe('create_consignment — one order for one request to one client', () => {
  it('POSTs samples + client_id + requested_by / logged_by in the one call (contracts §6)', async () => {
    api.mockResolvedValueOnce({ id: 'cn-uuid', number: 'CN-1012', client_name: 'EDMAX', location: null, status: 'open', derived_status: 'requested', member_count: 2 });
    const r = await new CreateConsignmentTool().execute({
      samples: [{ tab: 'bulk', id: 'b1' }, { tab: 'specialty', id: 's1' }],
      client_id: 'client-1', requested_by: 'Ivo', logged_by: 'Gloria',
    });
    expect(api).toHaveBeenCalledTimes(1);
    const [path, init] = api.mock.calls[0]!;
    expect(path).toBe('/consignments');
    expect(JSON.parse(init.body)).toEqual({
      location: null, notes: null, client_id: 'client-1', requested_by: 'Ivo', logged_by: 'Gloria',
      samples: [{ tab: 'bulk', id: 'b1' }, { tab: 'specialty', id: 's1' }],
    });
    expect(r).toMatchObject({ number: 'CN-1012', client_name: 'EDMAX', status: 'requested', member_count: 2, added: 2, unresolved_refs: [] });
    expect(r.url).toContain('/consignments/cn-uuid');
  });

  it('refs are resolved through the one resolver; an ambiguous ref is reported with its reason, not dropped', async () => {
    api.mockImplementation(async (path: string) => {
      if (path === '/samples/resolve?ref=SL-8000') return { candidates: [{ tab: 'specialty', id: 's1', ref: 'SL-8000', receiver: 'Beyers', status: 'requested', date_on: '2026-09-20' }] };
      if (path === '/samples/resolve?ref=SL-7336') {
        return { candidates: [
          { tab: 'specialty', id: 'a', ref: 'SL-7336', receiver: 'TORCH', status: 'preparing', date_on: '2026-06-04' },
          { tab: 'specialty', id: 'b', ref: 'SL-7336', receiver: 'Sucafina NV', status: 'dispatched', date_on: '2026-06-10' },
        ] };
      }
      if (path === '/consignments') return { id: 'cn-uuid', number: 'CN-1013', member_count: 1 };
      throw new Error(`unexpected ${path}`);
    });
    const r = await new CreateConsignmentTool().execute({ refs: ['sl 8000', 'SL-7336'] });
    const body = JSON.parse(api.mock.calls.find((c) => c[0] === '/consignments')![1].body);
    expect(body.samples).toEqual([{ tab: 'specialty', id: 's1' }]);
    expect(r.unresolved_refs).toEqual(['SL-7336']);
    expect(r.unresolved?.[0]?.reason).toMatch(/SL-7336 has 2 sends: .* Which receiver\?/);
  });
});
