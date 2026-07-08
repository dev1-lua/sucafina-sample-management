import { env } from 'lua-cli';

/**
 * Deep-links from an agent write back to the exact dashboard record it touched.
 *
 * After a successful create / dispatch / result / client write, the tool returns
 * a `url`; the persona surfaces it so the team can click straight to the row
 * (opening its DetailDrawer / show-page) with a "just created / just updated"
 * highlight (?hl=). Kept in one place so every write tool builds the same shape,
 * and so the agent never constructs a URL by hand.
 *
 * Dashboard routes (dashboard-v2/src/App.tsx):
 *   specialty  -> /samples/:id      (drawer)
 *   bulk       -> /bulk/:id         (drawer)
 *   forwarding -> /forwarding/:id   (drawer)
 *   clients    -> /clients/:id      (full show-page)
 * NB: these are the DASHBOARD paths, which differ from the API TAB_ENDPOINT paths
 * (e.g. specialty is /samples here but /specialty-samples on the API).
 */
export const LINK_TABS = ['specialty', 'bulk', 'forwarding', 'clients'] as const;
export type LinkTab = (typeof LINK_TABS)[number];

/** Dashboard route prefix per linkable tab (NOT the API endpoint). */
const DASH_PATH: Record<LinkTab, string> = {
  specialty: '/samples',
  bulk: '/bulk',
  forwarding: '/forwarding',
  clients: '/clients',
};

export type LinkEvent = 'created' | 'updated';

/**
 * Absolute dashboard URL for one record. `?hl=` drives the landing highlight
 * (banner + row flash). Reads DASHBOARD_BASE_URL from the platform env, falling
 * back to the assumed Vercel domain when unset — CONFIRM/override the real
 * production domain via the DASHBOARD_BASE_URL env var (sandbox + prod), the
 * same way API_BASE_URL is set.
 */
export function dashboardUrl(tab: LinkTab, id: string | number, event: LinkEvent): string {
  const base = (env('DASHBOARD_BASE_URL') || 'https://sucafina-sample-management.vercel.app').replace(/\/+$/, '');
  return `${base}${DASH_PATH[tab]}/${id}?hl=${event}`;
}
