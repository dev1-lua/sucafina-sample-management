import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { Sidebar } from './Sidebar';

it('renders all nav destinations', () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Sidebar />
    </MemoryRouter>,
  );
  ['Dashboard', 'Sample', 'Bulk', 'Forwarding', 'Clients', 'Chaser', 'Assistant'].forEach((l) =>
    expect(screen.getByText(l)).toBeInTheDocument(),
  );
});
