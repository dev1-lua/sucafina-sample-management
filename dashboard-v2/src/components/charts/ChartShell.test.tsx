import { render, screen } from '@testing-library/react';
import { ChartShell } from './ChartShell';

it('renders the title', () => {
  render(<ChartShell title="Test Chart" />);
  expect(screen.getByText('Test Chart')).toBeInTheDocument();
});

it('renders an optional subtitle', () => {
  render(<ChartShell title="Test Chart" subtitle="Top 15" />);
  expect(screen.getByText('Top 15')).toBeInTheDocument();
});

it('renders children as the plot body', () => {
  render(
    <ChartShell title="Test Chart">
      <div>Chart body</div>
    </ChartShell>,
  );
  expect(screen.getByText('Chart body')).toBeInTheDocument();
});

it('shows the empty message and withholds children when isEmpty is set', () => {
  render(
    <ChartShell title="Test Chart" isEmpty emptyMessage="No samples yet">
      <div>Chart body</div>
    </ChartShell>,
  );
  expect(screen.getByText('No samples yet')).toBeInTheDocument();
  expect(screen.queryByText('Chart body')).not.toBeInTheDocument();
});

it('falls back to a default empty message', () => {
  render(<ChartShell title="Test Chart" isEmpty />);
  expect(screen.getByText('No data yet')).toBeInTheDocument();
});

it('shows a loading skeleton and withholds children while loading', () => {
  render(
    <ChartShell title="Test Chart" loading>
      <div>Chart body</div>
    </ChartShell>,
  );
  expect(screen.queryByText('Chart body')).not.toBeInTheDocument();
});
