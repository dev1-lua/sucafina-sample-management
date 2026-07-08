import { render, screen } from '@testing-library/react';
import { KpiTile } from './KpiTile';

it('renders the label and value', () => {
  render(<KpiTile label="Test Label" value="42" />);
  expect(screen.getByText('Test Label')).toBeInTheDocument();
  expect(screen.getByText('42')).toBeInTheDocument();
});

it('renders an optional hint', () => {
  render(<KpiTile label="Test Label" value="42" hint="Additional info" />);
  expect(screen.getByText('Additional info')).toBeInTheDocument();
});

it('renders without a hint when not provided', () => {
  render(<KpiTile label="Test Label" value="42" />);
  expect(screen.queryByText(/Additional/)).not.toBeInTheDocument();
});

it('renders a dash placeholder for value', () => {
  render(<KpiTile label="Test Label" value="—" />);
  expect(screen.getByText('—')).toBeInTheDocument();
});

it('shows a loading skeleton instead of the value and hint while loading', () => {
  render(<KpiTile label="Test Label" value="42" hint="Additional info" loading />);
  expect(screen.getByText('Test Label')).toBeInTheDocument();
  expect(screen.queryByText('42')).not.toBeInTheDocument();
  expect(screen.queryByText('Additional info')).not.toBeInTheDocument();
});
