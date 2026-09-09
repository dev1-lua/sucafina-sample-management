import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ActorPrompt, ActorPromptProvider } from './ActorPrompt';
import { actorHeader, getActorName, setActorName } from '@/lib/actor';

const ROSTER = [
  { id: 'id-harriet', name: 'Harriet', role: 'qc', email: null },
  { id: 'id-ivo', name: 'Ivo', role: 'trader', email: null },
];

function stubFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ data: ROSTER, total: ROSTER.length }), { status: 200 }),
  );
}

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  localStorage.clear();
  setActorName(null);
});
afterEach(() => vi.restoreAllMocks());

it('saves a roster pick and stamps the actor header with it', async () => {
  stubFetch();
  const onOpenChange = vi.fn();
  render(wrap(<ActorPrompt open onOpenChange={onOpenChange} />));

  expect(screen.getByRole('dialog', { name: /who.s using the dashboard/i })).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: 'Harriet' }));
  expect(screen.getByRole('button', { name: 'Harriet' })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  expect(getActorName()).toBe('Harriet');
  expect(actorHeader()).toBe('dashboard:Harriet');
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('accepts a typed name when the person is not on the roster; Save stays disabled while blank', async () => {
  stubFetch();
  const onOpenChange = vi.fn();
  render(wrap(<ActorPrompt open onOpenChange={onOpenChange} />));

  const save = screen.getByRole('button', { name: 'Save' });
  expect(save).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/your name/i), '  Ivo Jr. ');
  expect(save).toBeEnabled();
  await userEvent.click(save);

  expect(getActorName()).toBe('Ivo Jr.');
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it('provider opens the prompt on first load only when no name is stored', async () => {
  stubFetch();
  const { unmount } = render(wrap(<ActorPromptProvider><p>shell</p></ActorPromptProvider>));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  unmount();

  setActorName('Harriet');
  render(wrap(<ActorPromptProvider><p>shell</p></ActorPromptProvider>));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText('shell')).toBeInTheDocument();
});
