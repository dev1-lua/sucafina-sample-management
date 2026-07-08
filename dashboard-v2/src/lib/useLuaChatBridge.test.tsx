import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

import { useLuaChatBridge } from './useLuaChatBridge';

// Shows the current in-app location so we can assert the bridge navigated.
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

function Harness() {
  useLuaChatBridge();
  return <LocationProbe />;
}

function renderBridge() {
  return render(
    <MemoryRouter
      initialEntries={['/assistant']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Harness />
    </MemoryRouter>,
  );
}

function postFromChat(data: unknown, origin = window.location.origin) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin }));
  });
}

it('navigates in-app when the chat posts an open-record message', () => {
  renderBridge();
  expect(screen.getByTestId('loc')).toHaveTextContent('/assistant');

  postFromChat({ source: 'lua-chat', type: 'open-record', path: '/samples/123?hl=created' });

  expect(screen.getByTestId('loc')).toHaveTextContent('/samples/123?hl=created');
});

it('ignores messages from a different origin', () => {
  renderBridge();
  postFromChat(
    { source: 'lua-chat', type: 'open-record', path: '/samples/999?hl=created' },
    'https://evil.example.com',
  );
  expect(screen.getByTestId('loc')).toHaveTextContent('/assistant');
});

it('ignores messages that are not our open-record shape or not an in-app path', () => {
  renderBridge();
  postFromChat({ source: 'somewhere-else', type: 'open-record', path: '/samples/1?hl=created' });
  postFromChat({ source: 'lua-chat', type: 'other' });
  postFromChat({ source: 'lua-chat', type: 'open-record', path: 'https://evil.example.com/steal' });
  expect(screen.getByTestId('loc')).toHaveTextContent('/assistant');
});
