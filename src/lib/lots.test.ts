import { describe, it, expect } from 'vitest';
import { coffeeLabel, lotSay, ordinal, refConflict, type LotResolution } from './lots';

const send = (receiver: string, date_on: string, status = 'delivered') => ({
  tab: 'bulk' as const, id: 'x', receiver, date_on, status, qty_grams: 300, courier_norm: null, awb: null,
});
const lot = (o: Partial<LotResolution['lot'] & object>) => ({
  ref: 'TYPE-113', book: 'commercial' as const, coffee_key: 'k', outturn: null, grade: null, quality: 'AB FAQ', blend: null, first_issued_at: '2026-06-01T00:00:00Z', ...o,
});

describe('ordinal', () => {
  it('1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd 101st', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st']);
  });
});

describe('coffeeLabel — what a ref names', () => {
  it('specialty: outturn + grade, else the description', () => {
    expect(coffeeLabel({ book: 'specialty', outturn: '17KN0076', grade: 'AA' })).toBe('17KN0076 AA');
    expect(coffeeLabel({ book: 'specialty', outturn: null, grade: 'AB', quality: 'AB Sangalai' })).toBe('AB');
    expect(coffeeLabel({ book: 'specialty', quality: 'AB Sangalai' })).toBe('AB Sangalai');
  });
  it('commercial: quality (+ blend)', () => {
    expect(coffeeLabel({ book: 'commercial', quality: 'AB FAQ' })).toBe('AB FAQ');
    expect(coffeeLabel({ book: 'commercial', quality: 'AA PLUS (30%), AB (70%)', blend: 'AA PLUS 30% / AB 70%' })).toBe('AA PLUS (30%), AB (70%) · AA PLUS 30% / AB 70%');
  });
});

describe('lotSay — the line the model echoes', () => {
  it('reuse: same coffee, nth send, last receiver + date', () => {
    const res: LotResolution = { action: 'reuse', ref: 'SL-7336', lot: lot({ ref: 'SL-7336', book: 'specialty', outturn: '17KN0076', grade: 'AA', quality: null }), sends: [send('TORCH', '2026-06-04'), send('Sucafina NV', '2026-03-10')], reason: '' };
    expect(lotSay(res, { book: 'specialty', outturn: '17KN0076', grade: 'AA' })).toBe('Ref: SL-7336 (same coffee — 3rd send, last to TORCH 4 Jun)');
  });

  it('reuse with no earlier live send still reads', () => {
    const res: LotResolution = { action: 'reuse', ref: 'SL-7336', lot: lot({ ref: 'SL-7336' }), sends: [], reason: '' };
    expect(lotSay(res, { book: 'specialty', quality: 'AB' })).toBe('Ref: SL-7336 (same coffee — 1st send)');
  });

  it('conflict: names the existing coffee and its last send, then asks', () => {
    const res: LotResolution = { action: 'conflict', ref: 'TYPE-113', lot: lot({}), sends: [send('Joh Johanson', '2026-06-24')], reason: '' };
    expect(lotSay(res, { book: 'commercial', ref: 'TYPE-113', quality: 'C FAQ' })).toBe(
      'TYPE-113 is AB FAQ (sent to Joh Johanson 24 Jun). This is C FAQ — a different coffee, so it gets a new ref. OK, or did you mean AB FAQ?',
    );
  });

  it('new: a typed ref is claimed, otherwise the desk issues one', () => {
    expect(lotSay({ action: 'new', ref: 'TYPE-980', lot: null, sends: [], reason: '' }, { book: 'commercial', ref: 'TYPE-980', quality: 'AB FAQ' })).toBe("TYPE-980 is free — I'll use it");
    expect(lotSay({ action: 'new', ref: null, lot: null, sends: [], reason: '' }, { book: 'commercial', quality: 'AB FAQ' })).toBe('ref will be issued');
  });
});

describe('refConflict — the 409 the create routes answer (contracts §4)', () => {
  it('recognises status 409 + error ref_conflict and hands back the body', () => {
    const err = Object.assign(new Error('Sample API error 409'), { status: 409, body: { error: 'ref_conflict', ref: 'TYPE-113', lot: lot({}), sends: [] } });
    expect(refConflict(err)?.ref).toBe('TYPE-113');
  });
  it('anything else is not a conflict', () => {
    expect(refConflict(Object.assign(new Error('x'), { status: 409, body: { error: 'other' } }))).toBeNull();
    expect(refConflict(Object.assign(new Error('x'), { status: 400, body: { error: 'ref_conflict' } }))).toBeNull();
    expect(refConflict(new Error('x'))).toBeNull();
  });
});
