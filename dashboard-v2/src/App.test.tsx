import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from './App';

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
