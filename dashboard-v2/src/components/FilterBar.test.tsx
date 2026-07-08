import { render, screen, fireEvent } from '@testing-library/react';
import type { FilterDef } from '@/types';

import { FilterBar } from './FilterBar';

const defs = [
  { key: 'status', label: 'Status', type: 'enum', options: ['dispatched', 'delivered'], multi: true },
  { key: 'has_awb', label: 'Has AWB', type: 'bool', trueValue: 'true' },
] as const;

it('emits filter changes and clears', () => {
  const onChange = vi.fn();
  render(<FilterBar defs={defs as any} value={{}} onChange={onChange} />);
  fireEvent.click(screen.getByText('Has AWB'));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ has_awb: 'true' }));
});

it('renders a search input bound to q and a chip per def', () => {
  render(<FilterBar defs={defs as any} value={{}} onChange={vi.fn()} />);
  expect(screen.getByPlaceholderText('Search…')).toBeInTheDocument();
  expect(screen.getByText('Status')).toBeInTheDocument();
  expect(screen.getByText('Has AWB')).toBeInTheDocument();
});

it('typing in the search input emits q on the FilterState', () => {
  const onChange = vi.fn();
  render(<FilterBar defs={defs as any} value={{}} onChange={onChange} />);
  fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'kenya' } });
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ q: 'kenya' }));
});

it('clearing the search input drops q from FilterState', () => {
  const onChange = vi.fn();
  render(<FilterBar defs={defs as any} value={{ q: 'kenya', has_awb: 'true' }} onChange={onChange} />);
  fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: '' } });
  const next = onChange.mock.calls[0][0];
  expect(next).not.toHaveProperty('q');
  expect(next).toEqual({ has_awb: 'true' });
});

it('picking an enum multi option calls onChange with that key set as an array', () => {
  const onChange = vi.fn();
  render(<FilterBar defs={defs as any} value={{}} onChange={onChange} />);
  fireEvent.click(screen.getByText('Status'));
  fireEvent.click(screen.getByText('dispatched'));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: ['dispatched'] }));
});

it('a bool chip toggles off (removes the key) when active', () => {
  const onChange = vi.fn();
  render(<FilterBar defs={defs as any} value={{ has_awb: 'true' }} onChange={onChange} />);
  fireEvent.click(screen.getByText('Has AWB'));
  const next = onChange.mock.calls[0][0];
  expect(next).not.toHaveProperty('has_awb');
});

it('clearing an active chip via the × control removes its key(s)', () => {
  const onChange = vi.fn();
  render(<FilterBar defs={defs as any} value={{ status: ['dispatched'] }} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /clear status filter/i }));
  const next = onChange.mock.calls[0][0];
  expect(next).not.toHaveProperty('status');
});

it('does not mutate the incoming value object', () => {
  const onChange = vi.fn();
  const value = { has_awb: 'true' };
  render(<FilterBar defs={defs as any} value={value} onChange={onChange} />);
  fireEvent.click(screen.getByText('Has AWB'));
  expect(value).toEqual({ has_awb: 'true' });
});

it('date def writes the date_from/date_to pair, not def.key', () => {
  const dateDefs: FilterDef[] = [{ key: 'ship_date', label: 'Ship Date', type: 'date' }];
  const onChange = vi.fn();
  render(<FilterBar defs={dateDefs} value={{}} onChange={onChange} />);
  fireEvent.click(screen.getByText('Ship Date'));
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } });
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ date_from: '2026-01-01' }));
  expect(onChange.mock.calls[0][0]).not.toHaveProperty('ship_date');
});

it('numrange def writes minKey/maxKey', () => {
  const numDefs: FilterDef[] = [
    { key: 'qty', label: 'Quantity', type: 'numrange', minKey: 'qty_min', maxKey: 'qty_max' },
  ];
  const onChange = vi.fn();
  render(<FilterBar defs={numDefs} value={{}} onChange={onChange} />);
  fireEvent.click(screen.getByText('Quantity'));
  fireEvent.change(screen.getByLabelText('Min'), { target: { value: '10' } });
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ qty_min: '10' }));
});

it('text def writes a string under def.key', () => {
  const textDefs: FilterDef[] = [{ key: 'notes', label: 'Notes', type: 'text' }];
  const onChange = vi.fn();
  render(<FilterBar defs={textDefs} value={{}} onChange={onChange} />);
  fireEvent.click(screen.getByText('Notes'));
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'urgent' } });
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ notes: 'urgent' }));
});
