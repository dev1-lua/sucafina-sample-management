import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from './api';
import { resolveSampleByRef, resolveSampleCandidates } from './resolve-sample';

const api = apiFetch as unknown as ReturnType<typeof vi.fn>;

const send = (o: Partial<Record<string, unknown>>) => ({
  tab: 'specialty', id: 'id-1', ref: 'SL-7336', title: 'AB FAQ', receiver: 'TORCH', status: 'delivered',
  date_on: '2026-06-04', consignment_number: null, awb: null, courier_norm: null, ...o,
});

beforeEach(() => { api.mockReset(); });

describe('resolveSampleByRef — one resolver, GET /samples/resolve', () => {
  it('normalises the ref and passes tab + receiver as query params', async () => {
    api.mockResolvedValueOnce({ ref: 'SL-7336', candidates: [send({})] });
    const r = await resolveSampleByRef('sl 7336', { tab: 'specialty', receiver: 'torch' });
    expect(api).toHaveBeenCalledWith('/samples/resolve?ref=SL-7336&tab=specialty&receiver=torch');
    expect(r).toEqual({ tab: 'specialty', id: 'id-1', ref: 'SL-7336', receiver: 'TORCH' });
  });

  it('0 candidates → throws "No sample with ref X"', async () => {
    api.mockResolvedValueOnce({ ref: 'SL-9999', candidates: [] });
    await expect(resolveSampleByRef('SL-9999')).rejects.toThrow('No sample with ref SL-9999');
  });

  it('empty ref → throws before calling the API', async () => {
    await expect(resolveSampleByRef('  ')).rejects.toThrow(/ref/i);
    expect(api).not.toHaveBeenCalled();
  });

  it('several sends, receiver given, still >1 → picks the newest and says so', async () => {
    api.mockResolvedValueOnce({
      ref: 'SL-7336',
      candidates: [
        send({ id: 'new', receiver: 'Sucafina NV', date_on: '2026-06-10', status: 'dispatched' }),
        send({ id: 'old', receiver: 'Sucafina NV Antwerp', date_on: '2026-02-18' }),
      ],
    });
    const r = await resolveSampleByRef('SL-7336', { receiver: 'Sucafina' });
    expect(r.id).toBe('new');
    expect(r.note).toMatch(/newest/);
    expect(r.note).toContain('Sucafina NV');
  });

  it('several sends, no receiver, exactly one open → picks the open send with a note', async () => {
    api.mockResolvedValueOnce({
      ref: 'SL-7336',
      candidates: [
        send({ id: 'open', receiver: 'TORCH', status: 'preparing', date_on: '2026-06-04' }),
        send({ id: 'd1', receiver: 'Sucafina NV', status: 'delivered', date_on: '2026-03-10' }),
        send({ id: 'd2', receiver: 'Safari Lounge', status: 'closed', date_on: '2026-02-18' }),
      ],
    });
    const r = await resolveSampleByRef('SL-7336');
    expect(r).toEqual({
      tab: 'specialty', id: 'open', ref: 'SL-7336', receiver: 'TORCH',
      note: 'picked the open send → TORCH; SL-7336 has 2 older sends',
    });
  });

  it('several sends, no receiver, more than one open → throws listing every send and asks which receiver', async () => {
    api.mockResolvedValueOnce({
      ref: 'SL-7336',
      candidates: [
        send({ id: 'a', receiver: 'TORCH', status: 'preparing', date_on: '2026-06-04' }),
        send({ id: 'b', receiver: 'Sucafina NV', status: 'dispatched', date_on: '2026-06-10' }),
        send({ id: 'c', receiver: 'Safari Lounge', status: 'delivered', date_on: '2026-02-18' }),
      ],
    });
    await expect(resolveSampleByRef('SL-7336')).rejects.toThrow(
      'SL-7336 has 3 sends: → TORCH (4 Jun, preparing) · → Sucafina NV (10 Jun, dispatched) · → Safari Lounge (18 Feb, delivered). Which receiver?',
    );
  });

  it('several sends, none open → also asks which receiver (never guesses a closed send)', async () => {
    api.mockResolvedValueOnce({
      ref: 'SL-7336',
      candidates: [
        send({ id: 'a', receiver: 'TORCH', status: 'delivered' }),
        send({ id: 'c', receiver: 'Safari Lounge', status: 'delivered', date_on: '2026-02-18' }),
      ],
    });
    await expect(resolveSampleByRef('SL-7336')).rejects.toThrow(/has 2 sends: .* Which receiver\?/);
  });
});

describe('resolveSampleCandidates', () => {
  it('returns the raw candidate list for callers that list sends themselves', async () => {
    api.mockResolvedValueOnce({ ref: 'SL-7336', candidates: [send({}), send({ id: 'id-2' })] });
    const c = await resolveSampleCandidates('SL-7336');
    expect(c.map((s) => s.id)).toEqual(['id-1', 'id-2']);
  });
});
