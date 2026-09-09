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
    const err = new Error(`Sample API error ${res.status} on ${path}: ${text.slice(0, 300)}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}
