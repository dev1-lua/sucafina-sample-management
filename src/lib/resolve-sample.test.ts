import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from './api';
import { resolveSampleByRef, resolveSampleCandidates, describeOption, describeSend } from './resolve-sample';

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
    expect(r).toEqual({ tab: 'specialty', id: 'id-1', send_id: null, ref: 'SL-7336', receiver: 'TORCH' });
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
      tab: 'specialty', id: 'open', send_id: null, ref: 'SL-7336', receiver: 'TORCH',
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

describe('describeOption — one PSS option of a contract group, as the status answer lists it', () => {
  it('base · option → receiver, status date (courier awb)', () => {
    expect(describeOption('SSKE-104929', { option_letter: 'A', receiver: 'CK Corporation', status: 'dispatched', date_on: '2026-09-12', courier_norm: 'dhl', awb: '123' }))
      .toBe('SSKE-104929 · option A → CK Corporation, dispatched 12 Sep (DHL 123)');
  });
  it('no courier / AWB yet → no parenthesis; a courier alone still shows; no letter → "option ?"', () => {
    expect(describeOption('SSKE-104929', { option_letter: 'B', receiver: 'CK Corporation', status: 'requested', date_on: '2026-09-15', courier_norm: null, awb: null }))
      .toBe('SSKE-104929 · option B → CK Corporation, requested 15 Sep');
    expect(describeOption('SSKE-104929', { option_letter: 'C', receiver: null, status: 'preparing', date_on: null, courier_norm: 'wells_fargo', awb: null }))
      .toBe('SSKE-104929 · option C → ?, preparing ? (WELLS FARGO)');
    expect(describeOption('SSKE-104929', { option_letter: null, receiver: 'Paulig', status: 'delivered', date_on: '2026-09-01', courier_norm: null, awb: null }))
      .toBe('SSKE-104929 · option ? → Paulig, delivered 1 Sep');
  });
});

describe('Send ID (SS-1234, round 11) — one row, never "which receiver?"', () => {
  it('resolves through /samples/resolve?ref=SS-… to the one candidate, carrying send_id', async () => {
    api.mockResolvedValueOnce({ ref: 'SS-1234', candidates: [send({ id: 'row-9', send_id: 'SS-1234', receiver: 'TORCH', status: 'preparing' })] });
    const r = await resolveSampleByRef('ss 1234');
    expect(api).toHaveBeenCalledWith('/samples/resolve?ref=SS-1234');
    expect(r).toEqual({ tab: 'specialty', id: 'row-9', send_id: 'SS-1234', ref: 'SL-7336', receiver: 'TORCH' });
  });

  it('a receiver passed alongside a Send ID is dropped from the query (the id already names one send)', async () => {
    api.mockResolvedValueOnce({ ref: 'SS-1234', candidates: [send({ id: 'row-9', send_id: 'SS-1234' })] });
    const r = await resolveSampleByRef('SS-1234', { tab: 'specialty', receiver: 'someone else' });
    expect(api).toHaveBeenCalledWith('/samples/resolve?ref=SS-1234&tab=specialty');
    expect(r.id).toBe('row-9');
    expect(r.note).toBeUndefined();
  });

  it('should the API ever list more than one row for a Send ID, the row carrying it wins — no receiver question', async () => {
    api.mockResolvedValueOnce({
      ref: 'SS-1234',
      candidates: [
        send({ id: 'other', send_id: 'SS-1233', receiver: 'TORCH', status: 'preparing' }),
        send({ id: 'mine', send_id: 'SS-1234', receiver: 'Sucafina NV', status: 'dispatched' }),
      ],
    });
    const r = await resolveSampleByRef('SS-1234');
    expect(r).toMatchObject({ id: 'mine', send_id: 'SS-1234' });
    expect(r.note).toBeUndefined();
  });

  it('0 candidates → "No sample with Send ID SS-…"', async () => {
    api.mockResolvedValueOnce({ ref: 'SS-9999', candidates: [] });
    await expect(resolveSampleByRef('SS-9999')).rejects.toThrow('No sample with Send ID SS-9999 — check the Send ID with search_samples.');
  });

  it('the "which receiver?" listing leads each send with its Send ID when the rows carry one', async () => {
    api.mockResolvedValueOnce({
      ref: 'SL-7336',
      candidates: [
        send({ id: 'a', send_id: 'SS-1001', receiver: 'TORCH', status: 'preparing', date_on: '2026-06-04' }),
        send({ id: 'b', send_id: 'SS-1002', receiver: 'Sucafina NV', status: 'dispatched', date_on: '2026-06-10' }),
      ],
    });
    await expect(resolveSampleByRef('SL-7336')).rejects.toThrow(
      'SL-7336 has 2 sends: SS-1001 → TORCH (4 Jun, preparing) · SS-1002 → Sucafina NV (10 Jun, dispatched). Which receiver?',
    );
  });
});

describe('describeSend / describeOption carry the Send ID', () => {
  it('describeSend: "SS-1234 → TORCH (4 Jun, delivered)"; without a Send ID the old "→ TORCH (…)" line', () => {
    expect(describeSend(send({ send_id: 'SS-1234' }) as any)).toBe('SS-1234 → TORCH (4 Jun, delivered)');
    expect(describeSend(send({}) as any)).toBe('→ TORCH (4 Jun, delivered)');
    expect(describeSend(send({ send_id: null }) as any)).toBe('→ TORCH (4 Jun, delivered)');
  });
  it('describeOption: the Send ID sits after the option letter', () => {
    expect(describeOption('SSKE-104929', { option_letter: 'A', send_id: 'SS-77', receiver: 'CK Corporation', status: 'dispatched', date_on: '2026-09-12', courier_norm: 'dhl', awb: '123' }))
      .toBe('SSKE-104929 · option A · SS-77 → CK Corporation, dispatched 12 Sep (DHL 123)');
  });
});
