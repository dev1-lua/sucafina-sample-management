import { getTheme, setTheme, toggleTheme } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

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
