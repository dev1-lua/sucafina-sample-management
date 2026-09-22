import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import TeamPage from './TeamPage';

const ROSTER = [
  { id: 'id-harriet', name: 'Harriet', email: 'harriet.muthoni@sucafina.com', role: 'qc', active: true },
  { id: 'id-ivo', name: 'Ivo', email: null, role: 'trader', active: true },
  { id: 'id-ghost', name: 'Ghost', email: null, role: 'trader', active: false },
];

function stubFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'PATCH') {
      const id = url.split('/').pop();
      const row = ROSTER.find((r) => r.id === id)!;
      return new Response(JSON.stringify({ ...row, ...JSON.parse(String(init?.body)) }), { status: 200 });
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: 'id-new', role: 'trader', active: true, email: null, ...body }), {
        status: 201,
      });
    }
    return new Response(JSON.stringify({ data: ROSTER, total: ROSTER.length }), { status: 200 });
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <TeamPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

it('renders the roster with emails, missing-email warning, and inactive dimming', async () => {
  stubFetch();
  renderPage();
  expect(await screen.findByText('Harriet')).toBeInTheDocument();
  expect(screen.getByDisplayValue('harriet.muthoni@sucafina.com')).toBeInTheDocument();
  // Ivo (active, no email) counts toward the warning; inactive Ghost does not.
  expect(screen.getByText(/1 person has no email on file/)).toBeInTheDocument();
  expect(screen.getByText('inactive')).toBeInTheDocument();
});

it('commits an email edit on blur via PATCH', async () => {
  const spy = stubFetch();
  renderPage();
  const input = await screen.findByLabelText('Email for Ivo');
  await userEvent.type(input, 'ivo@sucafina.com');
  await userEvent.tab(); // blur commits
  await waitFor(() => {
    const patch = spy.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patch).toBeTruthy();
    expect(String(patch![0])).toContain('/traders/id-ivo');
    expect(JSON.parse(String(patch![1]!.body))).toEqual({ email: 'ivo@sucafina.com' });
  });
});

it('rejects an invalid email without calling the API', async () => {
  const spy = stubFetch();
  renderPage();
  const input = await screen.findByLabelText('Email for Ivo');
  await userEvent.type(input, 'not-an-email');
  await userEvent.tab();
  expect(await screen.findByText('Not a valid email')).toBeInTheDocument();
  expect(spy.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
});

// Round 10 (C): the roster is colleagues only — a client's contact belongs on the client record.
const DOMAIN_ERROR = 'Team emails must be @sucafina.com — a client\'s contact goes on the client record';

it('rejects a non-@sucafina.com email inline (case-insensitive domain) without calling the API', async () => {
  const spy = stubFetch();
  renderPage();
  const input = await screen.findByLabelText('Email for Ivo');
  await userEvent.type(input, 'ivo@paulig.fi');
  await userEvent.tab();
  expect(await screen.findByText(DOMAIN_ERROR)).toBeInTheDocument();
  expect(spy.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);

  await userEvent.clear(input);
  await userEvent.type(input, 'Ivo@SUCAFINA.COM');
  await userEvent.tab();
  await waitFor(() => expect(spy.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
});

it('the Add-person dialog applies the same domain rule', async () => {
  const spy = stubFetch();
  renderPage();
  await screen.findByText('Harriet');
  await userEvent.click(screen.getByRole('button', { name: /add person/i }));
  await userEvent.type(screen.getByPlaceholderText('Muki'), 'Brian');
  await userEvent.type(screen.getByPlaceholderText('muki@sucafina.com'), 'brian@gmail.com');
  await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
  expect(await screen.findByText(DOMAIN_ERROR)).toBeInTheDocument();
  expect(spy.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

it("surfaces the API's 400 message when the server rejects the email", async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    if (init?.method === 'PATCH') {
      return new Response(JSON.stringify({ error: 'only @sucafina.com addresses are allowed on the team roster' }), { status: 400 });
    }
    return new Response(JSON.stringify({ data: ROSTER, total: ROSTER.length }), { status: 200 });
  });
  renderPage();
  const input = await screen.findByLabelText('Email for Ivo');
  await userEvent.type(input, 'ivo@sucafina.com');
  await userEvent.tab();
  expect(await screen.findByText('only @sucafina.com addresses are allowed on the team roster')).toBeInTheDocument();
});

it('adds a person through the dialog via POST', async () => {
  const spy = stubFetch();
  renderPage();
  await screen.findByText('Harriet');
  await userEvent.click(screen.getByRole('button', { name: /add person/i }));
  await userEvent.type(screen.getByPlaceholderText('Muki'), 'Brian');
  await userEvent.type(screen.getByPlaceholderText('muki@sucafina.com'), 'brian.were@sucafina.com');
  await userEvent.click(screen.getByRole('button', { name: 'Add person' }));
  await waitFor(() => {
    const post = spy.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post).toBeTruthy();
    expect(JSON.parse(String(post![1]!.body))).toEqual({
      name: 'Brian',
      email: 'brian.were@sucafina.com',
      role: 'trader',
    });
  });
});

it('toggles active state via PATCH', async () => {
  const spy = stubFetch();
  renderPage();
  await screen.findByText('Ghost');
  await userEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
  await waitFor(() => {
    const patch = spy.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(String(patch![0])).toContain('/traders/id-ghost');
    expect(JSON.parse(String(patch![1]!.body))).toEqual({ active: true });
  });
});
