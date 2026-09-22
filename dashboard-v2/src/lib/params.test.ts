import { buildListParams, readListUrl, writeListUrl } from './params';

// Round 10: `ref`, `consignment` and `view` live in the URL so agent deep-links like
// `/specialty?ref=SL-7336` and `/commercial?view=coffees&ref=SL-7336` land on the right view.
describe('list URL round-trip', () => {
  it('reads ref/consignment into FilterState and view separately; ignores unknown keys', () => {
    const { filters, view } = readListUrl(new URLSearchParams('view=coffees&ref=SL-7336&consignment=CN-1012&hl=created'));
    expect(filters).toEqual({ ref: 'SL-7336', consignment: 'CN-1012' });
    expect(view).toBe('coffees');
  });
  it('a bogus view reads as null; a missing one too', () => {
    expect(readListUrl(new URLSearchParams('view=bananas')).view).toBeNull();
    expect(readListUrl(new URLSearchParams('')).view).toBeNull();
  });
  it('writes view + the two filters, drops them when cleared, and leaves other params alone', () => {
    const next = writeListUrl(new URLSearchParams('hl=created&ref=OLD&consignment=CN-1'), { ref: 'SL-7336', status: ['dispatched'] }, 'orders');
    expect(next.get('hl')).toBe('created');
    expect(next.get('ref')).toBe('SL-7336');
    expect(next.has('consignment')).toBe(false); // cleared
    expect(next.get('view')).toBe('orders');
    expect(next.has('status')).toBe(false); // only the deep-link keys are mirrored
    // The default view is not written, so plain links stay plain.
    expect(writeListUrl(new URLSearchParams('view=coffees'), {}, 'sends').has('view')).toBe(false);
  });
  it('round-trips', () => {
    const read = readListUrl(writeListUrl(new URLSearchParams(''), { ref: 'SL-7336', consignment: 'CN-1012' }, 'coffees'));
    expect(read).toEqual({ filters: { ref: 'SL-7336', consignment: 'CN-1012' }, view: 'coffees' });
  });
});

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
