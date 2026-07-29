import { tagColor, stockTag } from './tags';

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

it('stockTag: out at 0, low below qty, null when untracked or sufficient', () => {
  expect(stockTag(0, 300)).toBe('out_of_stock');
  expect(stockTag(100, 300)).toBe('low_stock');
  expect(stockTag(500, 300)).toBeNull();
  expect(stockTag(null, 300)).toBeNull();
  expect(stockTag(100, null)).toBeNull(); // no send qty → nothing to compare against
  expect(tagColor('stock', 'low_stock')).toContain('amber');
  expect(tagColor('stock', 'out_of_stock')).toContain('rose');
});
