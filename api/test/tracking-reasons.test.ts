import { describe, it, expect } from 'vitest';
import { reasonFromText } from '../src/lib/tracking/reasons.js';

describe('reasonFromText', () => {
  it('classifies customs/clearance text', () => {
    expect(reasonFromText('Held for customs clearance')).toBe('customs_hold');
    expect(reasonFromText('Clearance delay - Import')).toBe('customs_hold');
  });
  it('classifies address text', () => {
    expect(reasonFromText('Address problem - unable to deliver')).toBe('address_problem');
  });
  it('classifies return text', () => {
    expect(reasonFromText('Returned to shipper')).toBe('returned');
  });
  it('classifies refusal text', () => {
    expect(reasonFromText('Delivery refused by receiver')).toBe('refused');
  });
  it('classifies damage text', () => {
    expect(reasonFromText('Package damaged in transit')).toBe('damaged');
  });
  it('returns null when nothing specific matches', () => {
    expect(reasonFromText('Shipment on hold')).toBeNull();
    expect(reasonFromText('')).toBeNull();
  });
});
