import { render, screen } from '@testing-library/react';
import { ChartShell } from './ChartShell';

it('renders the title', () => {
  render(<ChartShell title="Test Chart" />);
  expect(screen.getByText('Test Chart')).toBeInTheDocument();
});

it('renders the Phase 4 placeholder text', () => {
  render(<ChartShell title="Test Chart" />);
  expect(screen.getByText('Chart — Phase 4')).toBeInTheDocument();
});
