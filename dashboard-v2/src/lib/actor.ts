import { useSyncExternalStore } from 'react';

// Who is using the dashboard. The API's audit trail records the `x-actor` header on
// every write, and the Quality team reads it back on edits and deletions — so once a
// name is known every request goes out as `dashboard:<Name>` instead of a bare
// `dashboard`. Stored per browser in localStorage; falls back to an in-memory value
// when storage is unavailable (private mode, blocked site data) so the header still
// carries the name for the rest of the session.

export const ACTOR_STORAGE_KEY = 'sucafina-actor-name';

let fallback: string | null = null;
const listeners = new Set<() => void>();

function normalize(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** The stored name, or null when nobody has introduced themselves yet. */
export function getActorName(): string | null {
  try {
    return normalize(localStorage.getItem(ACTOR_STORAGE_KEY));
  } catch {
    return fallback;
  }
}

/** Persist (or, with null/blank, clear) the name and notify `useActorName` subscribers. */
export function setActorName(name: string | null): void {
  const next = normalize(name);
  fallback = next;
  try {
    if (next) localStorage.setItem(ACTOR_STORAGE_KEY, next);
    else localStorage.removeItem(ACTOR_STORAGE_KEY);
  } catch {
    // Storage unavailable — the in-memory fallback carries the name for this session.
  }
  for (const listener of listeners) listener();
}

/** Value for the `x-actor` request header: `dashboard:<Name>`, or `dashboard` when unknown. */
export function actorHeader(): string {
  const name = getActorName();
  return name ? `dashboard:${name}` : 'dashboard';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React binding: re-renders when the name changes anywhere in the app. */
export function useActorName(): string | null {
  return useSyncExternalStore(subscribe, getActorName, getActorName);
}
