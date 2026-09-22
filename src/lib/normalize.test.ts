import { describe, it, expect } from 'vitest';
import { lotRefFor, normalizeRef } from './normalize';

describe('normalizeRef — the same rule as the API (contracts: Ref normalisation)', () => {
  it('upper-cases and collapses spaces around the dash', () => {
    expect(normalizeRef('type - 980')).toBe('TYPE-980');
    expect(normalizeRef('sl-7336')).toBe('SL-7336');
  });

  it('turns a bare space between prefix and number into the dash', () => {
    expect(normalizeRef('TYPE 980')).toBe('TYPE-980');
    expect(normalizeRef('  sske   104929d ')).toBe('SSKE-104929D');
  });

  it('collapses doubled dashes', () => {
    expect(normalizeRef('TYPE--980')).toBe('TYPE-980');
  });

  it('leaves an already-canonical ref alone', () => {
    expect(normalizeRef('SSKE-104929D')).toBe('SSKE-104929D');
    expect(normalizeRef('UGF/25/015')).toBe('UGF/25/015');
  });

  it('empty input is undefined', () => {
    expect(normalizeRef('')).toBeUndefined();
    expect(normalizeRef('   ')).toBeUndefined();
    expect(normalizeRef(null)).toBeUndefined();
    expect(normalizeRef(undefined)).toBeUndefined();
  });
});

describe('lotRefFor — the lot a ref groups under (round 10b: PSS options share the contract)', () => {
  it('a lettered PSS ref groups under its contract base', () => {
    expect(lotRefFor('SSKE-104929A')).toBe('SSKE-104929');
    expect(lotRefFor('sske 104929c')).toBe('SSKE-104929');
    expect(lotRefFor('SSKE-104929')).toBe('SSKE-104929');
  });
  it('every other ref is just its normalised self', () => {
    expect(lotRefFor('type - 980')).toBe('TYPE-980');
    expect(lotRefFor('SL-7336')).toBe('SL-7336');
    expect(lotRefFor('SSKE-104929AB')).toBe('SSKE-104929AB');
    expect(lotRefFor('UGF/25/015')).toBe('UGF/25/015');
  });
  it('empty input stays undefined', () => {
    expect(lotRefFor('')).toBeUndefined();
    expect(lotRefFor(null)).toBeUndefined();
  });
});
