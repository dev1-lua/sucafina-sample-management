it('optimistic merge overlays patched fields onto the cached row', () => {
  const prev = { id: '1', status: 'requested', awb: null };
  const body = { status: 'dispatched', awb: 'X1' };
  expect({ ...prev, ...body }).toEqual({ id: '1', status: 'dispatched', awb: 'X1' });
});
