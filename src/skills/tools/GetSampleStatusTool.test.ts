import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../lib/api';
import GetSampleStatusTool from './GetSampleStatusTool';

const api = apiFetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { api.mockReset(); });

const LOT = { ref: 'SSKE-104929', book: 'commercial', coffee_key: 'k', outturn: null, grade: null, quality: 'AB FAQ', blend: null, first_issued_at: '2026-08-01T00:00:00Z', created_by: null };
const GROUP_SENDS = [
  { tab: 'bulk', id: 'b2', ref: 'SSKE-104929B', option_letter: 'B', title: null, receiver: 'CK Corporation', date_on: '2026-09-15', status: 'requested', qty_grams: 500, courier_norm: null, awb: null, consignment_number: null },
  { tab: 'bulk', id: 'b1', ref: 'SSKE-104929A', option_letter: 'A', title: null, receiver: 'CK Corporation', date_on: '2026-09-12', status: 'dispatched', qty_grams: 500, courier_norm: 'dhl', awb: '123', consignment_number: null },
];

/** The API as the status tool sees it; `lots` = what GET /lots/SSKE-104929 answers (a 404 error when null). */
function wire(o: { resolve?: any[]; lots?: { lot: any; sends: any[] } | null; search?: any[] } = {}) {
  const calls: string[] = [];
  api.mockImplementation(async (path: string) => {
    calls.push(path);
    if (path.startsWith('/samples/resolve')) return { candidates: o.resolve ?? [] };
    if (path.startsWith('/lots/')) {
      if (o.lots) return o.lots;
      const err = new Error('Sample API error 404 on /lots/x: {"error":"lot not found"}') as Error & { status?: number; body?: unknown };
      err.status = 404; err.body = { error: 'lot not found' };
      throw err;
    }
    if (path.startsWith('/search?')) return { data: o.search ?? [] };
    throw new Error(`unexpected ${path}`);
  });
  return calls;
}

describe('get_sample_status — "where is SSKE-104929?" (the contract base, no letter)', () => {
  it('no row carries the bare base → the PSS group answers, one line per option, A→Z', async () => {
    const calls = wire({ lots: { lot: LOT, sends: GROUP_SENDS } });
    const r = await new GetSampleStatusTool().execute({ ref_or_id: 'sske 104929' });
    expect(calls).toEqual(['/samples/resolve?ref=SSKE-104929', '/lots/SSKE-104929']);
    expect(r).toMatchObject({ found: true, ref: 'SSKE-104929', pss_group: true, options: ['A', 'B'], lot: LOT });
    expect(r.sends.map((s: any) => s.line)).toEqual([
      'SSKE-104929 · option A → CK Corporation, dispatched 12 Sep (DHL 123)',
      'SSKE-104929 · option B → CK Corporation, requested 15 Sep',
    ]);
    expect(r.sends[0]).toMatchObject({ tab: 'bulk', id: 'b1', ref: 'SSKE-104929A', option_letter: 'A', open: true });
    expect(r._note).toMatch(/2 options/);
  });

  it('receiver narrows the group', async () => {
    wire({ lots: { lot: LOT, sends: [...GROUP_SENDS, { ...GROUP_SENDS[0], id: 'b3', ref: 'SSKE-104929C', option_letter: 'C', receiver: 'Paulig' }] } });
    const r = await new GetSampleStatusTool().execute({ ref_or_id: 'SSKE-104929', receiver: 'paulig' });
    expect(r.sends.map((s: any) => s.option_letter)).toEqual(['C']);
    expect(r.options).toEqual(['A', 'B', 'C']);
  });

  it('no such group (404) → the cross-book text search, as before', async () => {
    const calls = wire({ lots: null, search: [] });
    const r = await new GetSampleStatusTool().execute({ ref_or_id: 'SSKE-999999' });
    expect(calls).toEqual(['/samples/resolve?ref=SSKE-999999', '/lots/SSKE-999999', '/search?q=SSKE-999999&pageSize=5']);
    expect(r).toMatchObject({ found: false });
  });

  it('a lettered ref or a non-PSS ref with no row never asks the lots route', async () => {
    const calls = wire({ search: [] });
    await new GetSampleStatusTool().execute({ ref_or_id: 'SSKE-104929A' });
    await new GetSampleStatusTool().execute({ ref_or_id: 'TYPE-980' });
    expect(calls.filter((c) => c.startsWith('/lots/'))).toEqual([]);
  });

  it('a row that does carry the bare base still wins (exact resolve first)', async () => {
    const calls = wire({ resolve: [{ tab: 'bulk', id: 'b9', ref: 'SSKE-104929', receiver: 'Nespresso', status: 'delivered', date_on: '2026-06-01' }] });
    api.mockImplementationOnce(async (path: string) => { calls.push(path); return { candidates: [{ tab: 'bulk', id: 'b9', ref: 'SSKE-104929', receiver: 'Nespresso', status: 'delivered', date_on: '2026-06-01' }] }; });
    api.mockImplementationOnce(async (path: string) => { calls.push(path); return { id: 'b9', sample_ref: 'SSKE-104929' }; });
    const r = await new GetSampleStatusTool().execute({ ref_or_id: 'SSKE-104929' });
    expect(calls).toEqual(['/samples/resolve?ref=SSKE-104929', '/bulk-samples/b9']);
    expect(r).toMatchObject({ id: 'b9' });
  });
});
