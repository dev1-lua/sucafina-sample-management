// Vercel Edge Middleware — HTTP Basic Auth gate for the whole dashboard.
//
// Runs at the edge on every request BEFORE static files are served, so the
// password is validated server-side and never ships in the client JS bundle.
// Only runs on Vercel (production / preview / `vercel dev`) — a plain local
// `vite dev` does NOT run this file, so local development stays ungated.
//
// The password is read from the `SITE_PASSWORD` env var (set in the Vercel
// project settings — NOT committed, and intentionally not `VITE_`-prefixed so
// it is never bundled into the client). See dashboard-v2 README / deploy notes.

export const config = {
  runtime: 'edge',
  matcher: '/:path*', // gate every route + asset (root included)
};

export default function middleware(request: Request) {
  const password = process.env.SITE_PASSWORD;

  // No password configured => gate is intentionally off; serve the site normally.
  // (Fail-open on missing config avoids locking everyone out if the env var is
  // absent/mistyped. Switch to a 401 here if you'd rather fail closed.)
  if (!password) return;

  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice('Basic '.length)); // "username:password"
      const supplied = decoded.slice(decoded.indexOf(':') + 1); // password only; username ignored
      if (supplied === password) return; // authorized => continue to the app
    } catch {
      // malformed header => fall through to the 401 below
    }
  }

  return new Response('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Sucafina Sample Desk", charset="UTF-8"' },
  });
}
