export type Theme = 'light' | 'dark';
const KEY = 'sucafina-theme';

// Dark mode disabled for now — client wants a white UI (feedback #4). The theme
// machinery is kept but pinned to 'light', and the Header toggle is commented out.
// `setTheme` also strips any previously-persisted/system dark preference so users
// who had toggled dark before this change land back on light. To bring dark mode
// back, restore the original implementations preserved in the block comment below.

export function getTheme(): Theme {
  return 'light';
}

export function setTheme(_t: Theme): void {
  localStorage.removeItem(KEY);
  document.documentElement.classList.remove('dark');
}

export function toggleTheme(): Theme {
  setTheme('light');
  return 'light';
}

/*
export function getTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(t: Theme): void {
  localStorage.setItem(KEY, t);
  document.documentElement.classList.toggle('dark', t === 'dark');
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
*/
