import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { Sidebar } from './Sidebar';

it('renders all nav destinations', () => {
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Sidebar />
    </MemoryRouter>,
  );
  ['Dashboard', 'Sample Management', 'Clients', 'Chaser', 'Assistant'].forEach((l) =>
    expect(screen.getByText(l)).toBeInTheDocument(),
  );
  // Bulk/Forwarding are now tabs inside Sample Management, not standalone nav items.
  ['Bulk', 'Forwarding'].forEach((l) => expect(screen.queryByText(l)).not.toBeInTheDocument());
  // Favorites section was removed (feedback #1).
  ['Favorites', 'No favorites yet'].forEach((l) => expect(screen.queryByText(l)).not.toBeInTheDocument());
});
