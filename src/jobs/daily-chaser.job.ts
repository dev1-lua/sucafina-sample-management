import { LuaJob, User, env } from 'lua-cli';
import { apiFetch } from '../lib/api';

function fmtItem(i: any): string {
  // The digest projection (api/src/lib/digest.ts SUMMARY) exposes ref/quality/receiver/awb — there
  // is no deadline column on the three active tables, so we never reference one here. Commercial
  // rows now carry an auto-issued ref (migration 006), so "(no ref)" is a rare last-resort fallback.
  const bits = [i.ref ?? '(no ref)', i.quality, '→ ' + (i.receiver ?? '?')];
  if (i.awb) bits.push(`AWB ${i.awb}`);
  return '• ' + bits.filter(Boolean).join(' — ');
}

export const dailyChaserJob = new LuaJob({
  name: 'daily-chaser',
  description: 'Weekday-morning digest of samples that need chasing',
  schedule: { type: 'cron', expression: '0 6 * * 1-5', timezone: 'Africa/Nairobi' },
  execute: async () => {
    const digest = await apiFetch('/chaser/run', { method: 'POST', headers: { 'x-actor': 'job:chaser' } });
    const b = digest.buckets;
    const section = (title: string, bucket: any) =>
      `${title} (${bucket.count})\n${bucket.items.slice(0, 10).map(fmtItem).join('\n') || '• none 🎉'}`;
    const text = [
      `☕ Sample chaser — ${new Date().toDateString()}`,
      section('⏰ Not yet dispatched (past due)', b.not_dispatched),
      section('🚚 Dispatched, no delivery confirmation (>5d)', b.no_delivery_confirmation),
      section('📋 Delivered, awaiting results (>7d)', b.awaiting_results),
    ].join('\n\n');

    const userId = env('CHASER_USER_ID');
    if (userId) {
      const user = await User.get(userId);
      await user.send([{ type: 'text', text }]);
    }
    return {
      success: true,
      counts: {
        not_dispatched: b.not_dispatched.count,
        no_delivery_confirmation: b.no_delivery_confirmation.count,
        awaiting_results: b.awaiting_results.count,
      },
    };
  },
});
