// Every two hours in lab hours: ask the API to look up dispatched DHL/FedEx AWBs (POST /tracking/sweep).
// Delivered rows are promoted and the loop is pinged; customs/address problems ping QC + the account
// manager — both via the outbox that status-notifier drains. Registered in src/index.ts one version
// after details-chaser (v54) per the one-job-per-version protocol.
import { LuaJob } from 'lua-cli';
import { apiFetch } from '../lib/api';
export type SweepResult = { checked: number; delivered: number; exceptions: number; unchanged: number; errors: number; skipped_no_provider: number; remaining: number };
export async function runTrackingSweep(o: { api?: typeof apiFetch; limit?: number; minAgeHours?: number } = {}) {
  const api = o.api ?? apiFetch;
  const r = (await api('/tracking/sweep', { method: 'POST', headers: { 'x-actor': 'job:tracking-sweep' }, body: JSON.stringify({ limit: o.limit ?? 40, min_age_hours: o.minAgeHours ?? 4 }) })) as SweepResult;
  console.log(`[tracking-sweep] checked ${r.checked} · delivered ${r.delivered} · exceptions ${r.exceptions} · errors ${r.errors} · no provider ${r.skipped_no_provider} · remaining ${r.remaining}`);
  return { success: true, ...r };
}
export const trackingSweepJob = new LuaJob({
  name: 'tracking-sweep',
  description: 'Every two hours in lab hours, look up dispatched DHL/FedEx AWBs and record deliveries and courier exceptions',
  schedule: { type: 'cron', expression: '0 7-19/2 * * 1-6', timezone: 'Africa/Nairobi' },
  execute: async () => runTrackingSweep(),
});
