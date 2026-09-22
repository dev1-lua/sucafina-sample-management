import { lotRefFor, isPssGroup, optionLetterOf } from './lots';

describe('lotRefFor — the lot (group) key of a ref, mirroring api/src/lib/lots.ts', () => {
  it('strips one trailing option letter from a PSS ref, upper-casing and trimming first', () => {
    expect(lotRefFor('sske-104929b')).toBe('SSKE-104929');
    expect(lotRefFor('  SSKE-104929A ')).toBe('SSKE-104929');
  });

  it('leaves a base PSS ref and every other ref alone', () => {
    expect(lotRefFor('SSKE-104929')).toBe('SSKE-104929');
    expect(lotRefFor('TYPE-113')).toBe('TYPE-113');
    expect(lotRefFor('type-113')).toBe('TYPE-113');
    // Only SSKE strips a letter — a lettered specialty ref is its own coffee.
    expect(lotRefFor('SL-7336A')).toBe('SL-7336A');
    expect(lotRefFor('')).toBe('');
    expect(lotRefFor(null)).toBe('');
  });
});

describe('isPssGroup', () => {
  it('is true for a contract base ref only', () => {
    expect(isPssGroup('SSKE-104929')).toBe(true);
    expect(isPssGroup('sske-104929')).toBe(true);
    expect(isPssGroup('SSKE-104929A')).toBe(false);
    expect(isPssGroup('SL-7336')).toBe(false);
    expect(isPssGroup(null)).toBe(false);
  });
});

describe('optionLetterOf — the option letter of a send', () => {
  it('prefers option_letter, else the trailing letter of the send\'s own PSS ref, else null', () => {
    expect(optionLetterOf({ option_letter: 'C', ref: 'SSKE-104929C' })).toBe('C');
    expect(optionLetterOf({ option_letter: null, ref: 'SSKE-104929B' })).toBe('B');
    expect(optionLetterOf({ ref: 'sske-104929a' })).toBe('A');
    expect(optionLetterOf({ option_letter: null, ref: 'SSKE-104929' })).toBeNull();
    expect(optionLetterOf({ option_letter: null, ref: 'SL-7336A' })).toBeNull();
    expect(optionLetterOf({})).toBeNull();
  });
});
