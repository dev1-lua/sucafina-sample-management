import { tagColor, tagLabel, stockTag } from './tags';

it('maps known statuses to distinct palette classes', () => {
  expect(tagColor('status', 'dispatched')).toContain('blue');
  expect(tagColor('status', 'cancelled')).toContain('rose');
  expect(tagColor('result', 'approved')).toContain('emerald');
});

it('falls back to gray for unknown values', () => {
  expect(tagColor('status', 'nonsense')).toContain('slate');
});

it('maps known sample types to distinct palette classes', () => {
  expect(tagColor('sample_type', 'woc')).toContain('orange');
  expect(tagColor('sample_type', 'type')).toContain('indigo');
});

it('every palette entry carries both a light and dark class', () => {
  const cls = tagColor('status', 'preparing');
  expect(cls).toContain('dark:');
});

it('gap kind: address_needed is amber with a sentence-case label; other kinds humanize', () => {
  expect(tagColor('gap', 'address_needed')).toContain('amber');
  expect(tagLabel('gap', 'address_needed')).toBe('Address needed');
  expect(tagLabel('status', 'results_in')).toBe('results in');
});

it('contract_status kind: PSS states get sentence-case labels and their own colors', () => {
  expect(tagLabel('contract_status', 'pss_partial')).toBe('PSS partial');
  expect(tagLabel('contract_status', 'pss_pending')).toBe('PSS pending');
  expect(tagLabel('contract_status', 'pss_approved')).toBe('PSS approved');
  // Harriet's words (2026-09-10): the second rejection flags the contract "PSS replacement rejected".
  expect(tagLabel('contract_status', 'pss_replacement_rejected')).toBe('PSS replacement rejected');
  // Not a PSS state — humanized like every other kind.
  expect(tagLabel('contract_status', 'shipped')).toBe('shipped');
  expect(tagColor('contract_status', 'pss_approved')).toContain('emerald');
  expect(tagColor('contract_status', 'pss_replacement_rejected')).toContain('rose');
  expect(tagColor('contract_status', 'pss_partial')).toContain('blue');
  expect(tagColor('contract_status', 'shipped')).toContain('teal');
  expect(tagColor('contract_status', 'open')).toContain('slate');
});

it('stockTag: out at 0, low below qty, null when untracked or sufficient', () => {
  expect(stockTag(0, 300)).toBe('out_of_stock');
  expect(stockTag(100, 300)).toBe('low_stock');
  expect(stockTag(500, 300)).toBeNull();
  expect(stockTag(null, 300)).toBeNull();
  expect(stockTag(100, null)).toBeNull(); // no send qty → nothing to compare against
  expect(tagColor('stock', 'low_stock')).toContain('amber');
  expect(tagColor('stock', 'out_of_stock')).toContain('rose');
});
