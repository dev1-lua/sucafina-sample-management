import { env } from 'lua-cli';

export async function apiFetch(path: string, init: RequestInit = {}): Promise<any> {
  const base = env('API_BASE_URL') || 'http://localhost:4000';
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-api-key': env('API_KEY') || 'dev-key-sucafina',
      'x-actor': 'agent:chat',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Sample API error ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  return res.json();
}
