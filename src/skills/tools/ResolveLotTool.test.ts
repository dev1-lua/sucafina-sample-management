import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../lib/api';
import ResolveLotTool from './ResolveLotTool';

const api = apiFetch as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { api.mockReset(); });

const lot = { ref: 'TYPE-113', book: 'commercial', coffee_key: 'k', outturn: null, grade: null, quality: 'AB FAQ', blend: null, first_issued_at: '2026-06-01T00:00:00Z' };

describe('resolve_lot — POST /lots/resolve + the say line', () => {
  it('sends the contract body (normalised ref, nulls for the blanks) and echoes reuse', async () => {
    api.mockResolvedValueOnce({ action: 'reuse', ref: 'TYPE-113', lot, sends: [{ tab: 'bulk', id: 'b1', receiver: 'Joh Johanson', date_on: '2026-06-24', status: 'delivered', qty_grams: 300, courier_norm: 'dhl', awb: null }], reason: 'same coffee' });
    const r = await new ResolveLotTool().execute({ book: 'commercial', ref: 'type - 113', quality: 'AB FAQ', sample_type: 'type' });
    expect(api).toHaveBeenCalledWith('/lots/resolve', {
      method: 'POST',
      body: JSON.stringify({ book: 'commercial', ref: 'TYPE-113', outturn: null, grade: null, quality: 'AB FAQ', blend: null, sample_type: 'type' }),
    });
    expect(r.action).toBe('reuse');
    expect(r.say).toBe('Ref: TYPE-113 (same coffee — 2nd send, last to Joh Johanson 24 Jun)');
  });

  it('conflict: the typed ref names another coffee — say asks before anything is written', async () => {
    api.mockResolvedValueOnce({ action: 'conflict', ref: 'TYPE-113', lot, sends: [{ tab: 'bulk', id: 'b1', receiver: 'Joh Johanson', date_on: '2026-06-24', status: 'delivered' }], reason: 'different coffee' });
    const r = await new ResolveLotTool().execute({ book: 'commercial', ref: 'TYPE-113', quality: 'C FAQ', sample_type: 'type' });
    expect(r.say).toBe('TYPE-113 is AB FAQ (sent to Joh Johanson 24 Jun). This is C FAQ — a different coffee, so it gets a new ref. OK, or did you mean AB FAQ?');
  });

  it('new without a ref: the desk issues one; new with a typed ref: it is claimed', async () => {
    api.mockResolvedValueOnce({ action: 'new', ref: null, lot: null, sends: [], reason: 'no lot' });
    expect((await new ResolveLotTool().execute({ book: 'specialty', outturn: '17KN0076', grade: 'AA', sample_type: 'offer' })).say).toBe('ref will be issued');
    api.mockResolvedValueOnce({ action: 'new', ref: 'TYPE-980', lot: null, sends: [], reason: 'free' });
    expect((await new ResolveLotTool().execute({ book: 'commercial', ref: 'TYPE-980', quality: 'AB FAQ', sample_type: 'type' })).say).toBe("TYPE-980 is free — I'll use it");
  });

  it('PSS reuse: the typed lettered ref goes as typed (normalised); say names the contract group and its next option', async () => {
    const pssLot = { ...lot, ref: 'SSKE-104929' };
    api.mockResolvedValueOnce({ action: 'reuse', ref: 'SSKE-104929', lot: pssLot, sends: [
      { tab: 'bulk', id: 'b2', receiver: 'Nespresso', date_on: '2026-09-01', status: 'delivered', option_letter: 'B' },
      { tab: 'bulk', id: 'b1', receiver: 'Nespresso', date_on: '2026-08-20', status: 'delivered', option_letter: 'A' },
    ], reason: 'pss group' });
    const r = await new ResolveLotTool().execute({ book: 'commercial', ref: 'sske 104929c', quality: 'AB FAQ', sample_type: 'pss' });
    expect(api).toHaveBeenCalledWith('/lots/resolve', {
      method: 'POST',
      body: JSON.stringify({ book: 'commercial', ref: 'SSKE-104929C', outturn: null, grade: null, quality: 'AB FAQ', blend: null, sample_type: 'pss' }),
    });
    expect(r.say).toBe('SSKE-104929 has options A, B; this will be C');
  });
});
