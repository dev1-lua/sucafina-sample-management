import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

it('renders a humanized label with the tag color', () => {
  render(<StatusBadge kind="status" value="results_in" />);
  const el = screen.getByText('results in');
  expect(el.className).toContain('violet');
});

it('renders an em-dash for null', () => {
  render(<StatusBadge kind="status" value={null} />);
  expect(screen.getByText('—')).toBeInTheDocument();
});

it('renders known result and sample_type kinds with humanized labels', () => {
  render(<StatusBadge kind="result" value="pending_feedback" />);
  expect(screen.getByText('pending feedback')).toBeInTheDocument();
});
