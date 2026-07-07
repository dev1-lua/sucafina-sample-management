import { LuaJob, User, env } from 'lua-cli';
import { apiFetch } from '../lib/api';

function fmtItem(i: any): string {
  const bits = [i.ref ?? '(no ref)', i.quality, '→ ' + (i.receiver ?? '?')];
  if (i.deadline) bits.push(`deadline ${String(i.deadline).slice(0, 10)}`);
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
