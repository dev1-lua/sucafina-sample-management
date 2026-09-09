// Hide every sample dated before a cutoff (soft delete; reversible). Harriet, round 6: "clean-up before 1 Aug 2026".
// Dry run:  npx tsx scripts/purge-before.ts --before 2026-08-01
// Apply:    npx tsx scripts/purge-before.ts --before 2026-08-01 --apply --backup-ack backups/pre-purge-2026-09-14.dump
// Restore:  npx tsx scripts/purge-before.ts --restore "2026-09-14 16:02:11.123456+00"
// Any other --before needs --i-mean-it. Runs against DATABASE_URL (on the VPS: docker compose … exec -T api npx tsx scripts/purge-before.ts …).
import { pool } from '../src/db.js';
import { purgeBefore, restorePurge, DEFAULT_BEFORE } from '../src/lib/purge-before.js';

const argv = process.argv.slice(2);
const val = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const restore = val('--restore');
if (restore) {
  const r = await restorePurge(pool, { purgeTs: restore });
  console.log(`RESTORED purge ${restore}:`); for (const [t, n] of Object.entries(r.restored)) console.log(`  ${t.padEnd(20)} ${n}`);
  console.log(`  consignments reopened: ${r.consignments_reopened}`);
} else {
  const report = await purgeBefore(pool, { before: val('--before') ?? DEFAULT_BEFORE, apply: argv.includes('--apply'), backupAck: val('--backup-ack'), iMeanIt: argv.includes('--i-mean-it') });
  console.log(`${report.applied ? 'APPLIED' : 'DRY RUN'} — cutoff ${report.before}`);
  console.log(`  table                before_cutoff  live  would_hide`);
  for (const t of report.tables) console.log(`  ${t.table.padEnd(20)} ${String(t.before_cutoff).padStart(13)}  ${String(t.live).padStart(4)}  ${String(t.would_hide).padStart(10)}`);
  console.log(`  pending outbox rows affected: ${report.outbox_pending_affected}`);
  console.log(`  consignments to close: ${report.consignments_to_close.map((c) => c.number).join(', ') || '(none)'}`);
  console.log(`  ref_counters: ${report.ref_counters_before.map((c) => `${c.prefix}=${c.next_val}`).join('  ')}`);
  if (report.applied) {
    console.log(`  hidden: ${Object.entries(report.hidden!).map(([t, n]) => `${t}=${n}`).join('  ')}`);
    console.log(`  ref_counters after: ${report.ref_counters_after!.map((c) => `${c.prefix}=${c.next_val}`).join('  ')}`);
    console.log(`  purge_ts (keep this for --restore): "${report.purge_ts}"`);
  } else console.log('re-run with --apply --backup-ack <dump path> to hide these rows');
}
await pool.end();
