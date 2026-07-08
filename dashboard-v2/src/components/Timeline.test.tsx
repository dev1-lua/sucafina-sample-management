import { render, screen } from '@testing-library/react';
import { Timeline } from './Timeline';
const evs = [{ id: 'e1', entity_type: 'specialty', entity_id: 's1', type: 'created', note: 'AB for Beyers', actor: 'seed', created_at: '2026-07-01T00:00:00Z' }];
it('renders one entry per event with type + note + actor', () => {
  render(<Timeline events={evs} />);
  expect(screen.getByText(/created/i)).toBeInTheDocument();
  expect(screen.getByText(/AB for Beyers/)).toBeInTheDocument();
  expect(screen.getByText(/seed/)).toBeInTheDocument();
});
it('renders an empty state when no events', () => {
  render(<Timeline events={[]} />);
  expect(screen.getByText(/no activity/i)).toBeInTheDocument();
});
