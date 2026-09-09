import { buildListParams } from './params';

it('serializes sort, pagination, scalar and array filters; drops empties', () => {
  const p = buildListParams({
    sort: { sort: 'date_on', order: 'desc' }, page: 2, pageSize: 25,
    filters: { status: ['dispatched', 'delivered'], courier_norm: 'dhl', country: '', has_awb: 'true' },
  });
  expect(p.get('sort')).toBe('date_on');
  expect(p.get('order')).toBe('desc');
  expect(p.get('page')).toBe('2');
  expect(p.get('status')).toBe('dispatched,delivered');
  expect(p.get('courier_norm')).toBe('dhl');
  expect(p.has('country')).toBe(false);
  expect(p.get('has_awb')).toBe('true');
});
it('sends a bool filter as `<key>=true` (address_missing mirrors has_awb / low_stock)', () => {
  const p = buildListParams({ sort: null, page: 1, pageSize: 25, filters: { address_missing: 'true', low_stock: 'true' } });
  expect(p.get('address_missing')).toBe('true');
  expect(p.get('low_stock')).toBe('true');
  // An untoggled bool filter is simply absent from the query string.
  const off = buildListParams({ sort: null, page: 1, pageSize: 25, filters: {} });
  expect(off.has('address_missing')).toBe(false);
});
it('omits sort when null', () => {
  const p = buildListParams({ sort: null, page: 1, pageSize: 25, filters: {} });
  expect(p.has('sort')).toBe(false);
});
