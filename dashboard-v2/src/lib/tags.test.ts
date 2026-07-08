import { tagColor } from './tags';

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
