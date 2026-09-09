// Hide every sample dated before a cutoff (soft delete; reversible). Harriet, round 6: "clean-up before 1 Aug 2026".
// Dry run:  npx tsx scripts/purge-before.ts --before 2026-08-01
// Apply:    npx tsx scripts/purge-before.ts --before 2026-08-01 --apply --backup-ack backups/pre-purge-2026-09-14.dump
// Restore:  npx tsx scripts/purge-before.ts --restore "2026-09-14 16:02:11.123456+00"
// Any other --before needs --i-mean-it. Runs against DATABASE_URL (on the VPS: docker compose … exec -T api npx tsx scripts/purge-before.ts …).
import { pool } from '../src/db.js';
import { purgeBefore, restorePurge, DEFAULT_BEFORE, requiredFlagValue, restoreNeedsAttention } from '../src/lib/purge-before.js';

const argv = process.argv.slice(2);
// Review round 1, #3: a flag present with no value, or whose "value" is another flag (e.g.
// `--apply --backup-ack --i-mean-it`), is a usage error — never a silent fallback/default.
let restore: string | undefined, before: string | undefined, backupAck: string | undefined;
try {
  restore = requiredFlagValue(argv, '--restore');
  before = requiredFlagValue(argv, '--before');
  backupAck = requiredFlagValue(argv, '--backup-ack');
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
}
if (restore) {
  const r = await restorePurge(pool, { purgeTs: restore });
  console.log(`RESTORED purge ${restore}:`); for (const [t, n] of Object.entries(r.restored)) console.log(`  ${t.padEnd(20)} ${n}`);
  console.log(`  consignments reopened: ${r.consignments_reopened}`);
  if (restoreNeedsAttention(r.restored, r.consignments_reopened)) {
    console.warn(`  WARNING: samples were restored but no consignment was reopened — worth a manual glance.`);
  }
} else {
  const report = await purgeBefore(pool, { before: before ?? DEFAULT_BEFORE, apply: argv.includes('--apply'), backupAck, iMeanIt: argv.includes('--i-mean-it') });
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
