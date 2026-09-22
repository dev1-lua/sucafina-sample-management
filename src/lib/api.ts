import { env } from 'lua-cli';
import { currentActor } from './current-user';

export async function apiFetch(path: string, init: RequestInit = {}): Promise<any> {
  const base = env('API_BASE_URL') || 'http://localhost:4000';
  // Who is acting: `agent:<Full Name>` from the Teams profile (Harriet's change alerts name the editor);
  // jobs override it with `job:<name>` through init.headers.
  const actor = await currentActor();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-api-key': env('API_KEY') || 'dev-key-sucafina',
      'x-actor': actor,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Sample API error ${res.status} on ${path}: ${text.slice(0, 300)}`) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    // The parsed error body, whole — a 409 ref_conflict carries the lot and its sends (lib/lots refConflict).
    try {
      err.body = JSON.parse(text);
    } catch {
      err.body = text;
    }
    throw err;
  }
  return res.json();
}
