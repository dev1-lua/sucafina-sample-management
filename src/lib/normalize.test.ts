import { describe, it, expect } from 'vitest';
import { normalizeRef } from './normalize';

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
