import { render, screen, fireEvent } from '@testing-library/react';

import { EditableSelect } from './EditableSelect';

const COURIERS = ['dhl', 'fedex', 'other'];

// These tests exercise the custom-value logic directly (input reveal + commit),
// which is the part feedback #10 adds. Opening the Radix Select popover is skipped
// on purpose — jsdom doesn't implement the pointer/scroll APIs Radix needs, and the
// custom path is reachable without it (a stored value outside `options` opens in
// custom mode).

it('shows a stored custom value in the text input and commits an edit to it', () => {
  const onCommit = vi.fn();
  render(<EditableSelect value="Aramex" options={COURIERS} onCommit={onCommit} />);

  const input = screen.getByDisplayValue('Aramex');
  fireEvent.change(input, { target: { value: 'Aramex Intl' } });
  fireEvent.blur(input);

  expect(onCommit).toHaveBeenCalledWith('Aramex Intl');
});

it('does not reveal the custom input for a preset value', () => {
  render(<EditableSelect value="dhl" options={COURIERS} onCommit={() => {}} />);
  expect(screen.queryByPlaceholderText(/type a custom value/i)).toBeNull();
});

it('falls back to "other" when the custom input is cleared', () => {
  const onCommit = vi.fn();
  render(<EditableSelect value="Aramex" options={COURIERS} onCommit={onCommit} />);

  const input = screen.getByDisplayValue('Aramex');
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.blur(input);

  expect(onCommit).toHaveBeenCalledWith('other');
});
