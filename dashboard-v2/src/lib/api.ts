export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${import.meta.env.VITE_API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-api-key': import.meta.env.VITE_API_KEY,
      'x-actor': 'dashboard',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}
