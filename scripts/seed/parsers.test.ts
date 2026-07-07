import { describe, it, expect } from 'vitest';
import {
  parseQtyGrams, normalizeCourier, classifySampleType, parseSheetDate, normalizeName, parseResult,
} from './parsers.js';

describe('parseQtyGrams', () => {
  it.each([
    ['200', 200], ['1KG', 1000], ['1 KG', 1000], ['2KG', 2000], ['500g', 500],
    ['350G', 350], ['60+ROAST', 60], ['201', 201], [300, 300],
  ])('%s -> %s', (raw, expected) => expect(parseQtyGrams(raw)).toBe(expected));
  it.each([[null, null], ['', null], ['HD', null]])('%s -> null', (raw, expected) =>
    expect(parseQtyGrams(raw)).toBe(expected));
});

describe('normalizeCourier', () => {
  it.each([
    ['DHL', 'dhl'], ['dhl', 'dhl'], ['DHL ', 'dhl'],
    ['FedEX', 'fedex'], ['Fedex', 'fedex'], ['fedex', 'fedex'],
    ['UPS', 'ups'],
    ['KIPTOO', 'rider'], ['Kiptoo', 'rider'], ['Rider', 'rider'], ['rider', 'rider'],
    ['HD', 'hand_delivery'], ['H/D', 'hand_delivery'], ['By Hand', 'hand_delivery'], ['hd', 'hand_delivery'],
    ['Picked by Client', 'client_pickup'],
    ['wellsfargo', 'other'], ['Wells Fargo', 'other'], ['SGS Kenya', 'other'], ['Fargo', 'other'],
  ])('%s -> %s', (raw, expected) => expect(normalizeCourier(raw)).toBe(expected));
  it('null for empty', () => expect(normalizeCourier(null)).toBeNull());
});

describe('classifySampleType', () => {
  it.each([
    ['Offer Sample', 'offer', null],
    ['Offer sample', 'offer', null],
    ['Offer Sample (Onbehalf of Vava)', 'offer', null],
    ['TYPE SAMPLE', 'type', null],
    ['Type sample', 'type', null],
    ['PSS JUNE SHIPMENT', 'pss', 'June'],
    ['PSS April shipment', 'pss', 'April'],
    ['PSS Dec Shipment', 'pss', 'December'],
    ['PSS AUGUST SHIPMENT', 'pss', 'August'],
    ['WOC samples', 'woc', null],
    ['flavor mapping', 'flavor_mapping', null],
    ['Marketing sample', 'marketing', null],
    ['Calibration Sample(On behalf of X)', 'calibration', null],
    ['Retention', 'retention', null],
    ['whatever else', 'other', null],
    [null, 'other', null],
  ])('%s -> %s / %s', (raw, type, month) => {
    const r = classifySampleType(raw);
    expect(r.type).toBe(type);
    expect(r.shipmentMonth).toBe(month);
  });
});

describe('parseSheetDate', () => {
  it('passes Date instances through', () => {
    const d = new Date('2026-06-11T00:00:00Z');
    expect(parseSheetDate(d)).toEqual(d);
  });
  it('parses dd/mm/yyyy strings', () => {
    expect(parseSheetDate('14/1/2025')?.toISOString().slice(0, 10)).toBe('2025-01-14');
    expect(parseSheetDate('31/07/2025')?.toISOString().slice(0, 10)).toBe('2025-07-31');
  });
  it('parses iso-ish strings', () => {
    expect(parseSheetDate('2025-09-01 00:00:00')?.toISOString().slice(0, 10)).toBe('2025-09-01');
  });
  it('null for junk', () => {
    expect(parseSheetDate('SL-7346')).toBeNull();
    expect(parseSheetDate(null)).toBeNull();
  });
});

describe('normalizeName', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalizeName('  Beyers   Koffie ')).toBe('beyers koffie');
  });
});

describe('parseResult', () => {
  it.each([
    ['Approved', 'approved'], ['Rejected', 'rejected'], ['300', null], [null, null],
  ])('%s -> %s', (raw, expected) => expect(parseResult(raw)).toBe(expected));
});
