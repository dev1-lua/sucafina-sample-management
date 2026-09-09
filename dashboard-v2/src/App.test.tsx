import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from './App';
import { setActorName } from '@/lib/actor';

// A stored name keeps the first-load "who's using the dashboard?" modal closed, so
// the shell underneath stays in the accessibility tree for the route assertions below.
// (Seeded before each render only — clearing it in an afterEach would run before
// Testing Library's own cleanup and update the still-mounted header chip outside act().)
beforeEach(() => setActorName('Test User'));

function renderApp(initialPath = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[initialPath]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it('renders the Team route with its header title', () => {
  renderApp('/team');
  expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument();
});

it('renders the shell with the Dashboard route by default', () => {
  renderApp('/');
  expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  expect(screen.getByText('Sucafina')).toBeInTheDocument();
});

it('renders the merged Sample Management section with its three tabs', () => {
  renderApp('/samples');
  expect(screen.getByRole('heading', { name: 'Sample Management' })).toBeInTheDocument();
  ['Speciality Samples', 'Commercial Samples', 'EA Forwarding'].forEach((l) =>
    expect(screen.getByRole('tab', { name: l })).toBeInTheDocument(),
  );
});

it('shows the Sample Management header title on the Commercial and Forwarding tab routes', () => {
  renderApp('/bulk');
  expect(screen.getByRole('heading', { name: 'Sample Management' })).toBeInTheDocument();
});

it('shows the stored name in the header chip, and asks for one on first load when none is stored', () => {
  const first = renderApp('/');
  expect(screen.getByRole('button', { name: /using the dashboard as Test User/i })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  // Unmount before clearing the name — the header chip subscribes to it, and updating a
  // mounted subscriber outside act() would only produce a warning, not a real assertion.
  first.unmount();

  setActorName(null);
  renderApp('/');
  expect(screen.getByRole('dialog', { name: /who.s using the dashboard/i })).toBeInTheDocument();
});
