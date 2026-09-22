import * as React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';

import { RecordTable } from './RecordTable';

// jsdom reports 0 for offsetWidth/offsetHeight, which makes @tanstack/react-virtual
// compute a zero-size viewport and render no rows at all. Give elements a stable,
// non-zero size so the virtualizer produces a real window of virtual items.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
});

function stubFetch(rows: Record<string, unknown>[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    return new Response(JSON.stringify({ data: rows, total: rows.length, page: 1, pageSize: 50 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}
const cols = [
  { key: 'ref', header: 'Ref', sortKey: 'ref' },
  { key: 'name', header: 'Name' },
];
const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
);

it('renders rows from the list payload', async () => {
  stubFetch([{ id: '1', ref: 'R1', name: 'Alpha' }]);
  render(wrap(<RecordTable endpoint="/specialty-samples" columns={cols} filters={{}} onRowClick={() => {}} />));
  await waitFor(() => expect(screen.getByText('R1')).toBeInTheDocument());
});

it('sortable header adds sort/order to the request; row click fires callback', async () => {
  const spy = stubFetch([{ id: '1', ref: 'R1', name: 'Alpha' }]);
  const onRow = vi.fn();
  render(wrap(<RecordTable endpoint="/specialty-samples" columns={cols} filters={{}} onRowClick={onRow} />));
  await waitFor(() => screen.getByText('R1'));
  fireEvent.click(screen.getByText('Ref'));
  await waitFor(() => expect(spy.mock.calls.some(([u]) => String(u).includes('sort=ref'))).toBe(true));
  fireEvent.click(screen.getByText('R1'));
  expect(onRow).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
});

it('a pinned column renders sticky-right header and body cells with an opaque background', async () => {
  stubFetch([{ id: '1', ref: 'R1', status: 'dispatched' }]);
  const pinnedCols = [
    { key: 'ref', header: 'Ref' },
    { key: 'status', header: 'Status', pinned: 'right' as const },
  ];
  render(wrap(<RecordTable endpoint="/specialty-samples" columns={pinnedCols} filters={{}} onRowClick={() => {}} />));
  await waitFor(() => screen.getByText('R1'));
  const headerCell = screen.getByText('Status').closest('th')!;
  expect(headerCell.className).toContain('sticky');
  expect(headerCell.className).toContain('right-0');
  const bodyCell = screen.getByText('dispatched').closest('td')!;
  expect(bodyCell.className).toContain('sticky');
  expect(bodyCell.className).toContain('bg-background');
  // Unpinned neighbors stay static.
  expect(screen.getByText('R1').closest('td')!.className).not.toContain('sticky');
});

// Round 10: parent → child rows (Coffees view). The children are supplied by the caller
// (loaded on expand) and rendered as full-width 32px rows, so the fixed-height virtualizer
// stays honest; the chevron is a real button (Enter/Space toggle) that keeps focus.
describe('expandable rows', () => {
  const CHILDREN: Record<string, Record<string, unknown>[]> = {
    'SL-1': [{ id: 's1', receiver: 'Sucafina NV' }, { id: 's2', receiver: 'Paulig' }],
  };
  function Harness({ onSubRowClick = () => {} }: { onSubRowClick?: (sub: Record<string, unknown>) => void }) {
    const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
    return (
      <RecordTable
        endpoint="/lots"
        columns={cols}
        filters={{}}
        onRowClick={(row) => setExpanded((e) => ({ ...e, [String(row.id)]: !e[String(row.id)] }))}
        expandable={{
          expanded,
          onExpandedChange: setExpanded,
          getSubRows: (row) => (expanded[String(row.id)] ? CHILDREN[String(row.id)] ?? [] : []),
          renderSubRow: (sub) => <span>→ {String(sub.receiver)}</span>,
          onSubRowClick,
          expandLabel: (row) => `Expand ${String(row.ref)}`,
        }}
        countLabel={(n) => `${n} coffees`}
      />
    );
  }

  it('renders a chevron per parent; toggling shows the children and collapses them again', async () => {
    stubFetch([{ id: 'SL-1', ref: 'SL-1', name: 'AA' }, { id: 'SL-2', ref: 'SL-2', name: 'AB' }]);
    render(wrap(<Harness />));
    await waitFor(() => screen.getByText('SL-1'));
    const chevron = screen.getByRole('button', { name: 'Expand SL-1' });
    expect(chevron).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('→ Sucafina NV')).not.toBeInTheDocument();
    fireEvent.click(chevron);
    expect(chevron).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('→ Sucafina NV')).toBeInTheDocument();
    expect(screen.getByText('→ Paulig')).toBeInTheDocument();
    // Children sit between their parent and the next parent.
    const texts = screen.getAllByRole('row').map((r) => r.textContent);
    expect(texts.findIndex((t) => t?.includes('→ Paulig'))).toBeLessThan(texts.findIndex((t) => t?.includes('SL-2')));
    fireEvent.click(chevron);
    expect(screen.queryByText('→ Sucafina NV')).not.toBeInTheDocument();
    expect(screen.getByText('2 coffees')).toBeInTheDocument();
  });

  it('Enter / Space on the focused chevron toggles and keeps focus on it', async () => {
    stubFetch([{ id: 'SL-1', ref: 'SL-1', name: 'AA' }]);
    const user = userEvent.setup();
    render(wrap(<Harness />));
    await waitFor(() => screen.getByText('SL-1'));
    const chevron = screen.getByRole('button', { name: 'Expand SL-1' });
    chevron.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('→ Sucafina NV')).toBeInTheDocument();
    expect(document.activeElement).toBe(chevron);
    await user.keyboard(' ');
    expect(screen.queryByText('→ Sucafina NV')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(chevron);
  });

  it('a child row click reports the child, not the parent row', async () => {
    stubFetch([{ id: 'SL-1', ref: 'SL-1', name: 'AA' }]);
    const onSub = vi.fn();
    render(wrap(<Harness onSubRowClick={onSub} />));
    await waitFor(() => screen.getByText('SL-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Expand SL-1' }));
    fireEvent.click(screen.getByText('→ Paulig'));
    expect(onSub).toHaveBeenCalledWith(expect.objectContaining({ id: 's2' }), expect.objectContaining({ id: 'SL-1' }));
  });
});
