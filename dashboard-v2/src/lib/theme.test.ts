import { getTheme, setTheme, toggleTheme } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

// Dark mode is disabled for now (feedback #4) — the theme is pinned to 'light' and
// setTheme actively strips any persisted dark preference. When dark mode is
// re-enabled, restore the original assertions preserved in the block comment below.

it('getTheme always returns light while dark mode is disabled', () => {
  expect(getTheme()).toBe('light');
});

it('setTheme keeps the app light and clears any stored dark preference', () => {
  localStorage.setItem('sucafina-theme', 'dark');
  document.documentElement.classList.add('dark');

  setTheme('dark'); // even an explicit dark request is neutralized
  expect(localStorage.getItem('sucafina-theme')).toBeNull();
  expect(document.documentElement.classList.contains('dark')).toBe(false);
});

it('toggleTheme is a no-op that stays on light', () => {
  expect(toggleTheme()).toBe('light');
  expect(getTheme()).toBe('light');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
});

/*
it('setTheme persists and toggles the .dark class', () => {
  setTheme('dark');
  expect(localStorage.getItem('sucafina-theme')).toBe('dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  setTheme('light');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
});

it('toggleTheme flips and returns the new theme', () => {
  setTheme('light');
  expect(toggleTheme()).toBe('dark');
  expect(getTheme()).toBe('dark');
});

it('getTheme falls back to system preference when nothing is stored', () => {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('dark'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  expect(getTheme()).toBe('dark');

  window.matchMedia = original;
});
*/
