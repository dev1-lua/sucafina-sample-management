// Give the rows logged before round 10 their order: live samples that share a real AWB and a client become
// ONE consignment (CN-####) — e.g. Parlor Coffee's three coffees of 2026-09-02 on DHL AWB 8309842892.
// Rows already in an order, groups of one, and placeholder AWBs ("HD", "n/a" — fewer than four digits in a
// row) are left alone. The apply is one transaction; running it twice changes nothing the second time.
// The legacy sheet shares one AWB across whole boxes back to 2023: `--since YYYY-MM-DD` floors the rows
// considered (date_on, else the day logged); without it every live row is in.
// Dry run:  npx tsx scripts/backfill-orders.ts --since 2026-08-01
// Apply:    npx tsx scripts/backfill-orders.ts --since 2026-08-01 --apply
// Runs against DATABASE_URL (on the VPS: docker compose … exec -T api npx tsx scripts/backfill-orders.ts --since 2026-08-01 --apply).
import { pool } from '../src/db.js';
import { backfillOrders } from '../src/lib/backfill-orders.js';
import { requiredFlagValue } from '../src/lib/purge-before.js';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
// A flag with no value (or another flag as its "value") is a usage error, never a silent default — as purge-before.ts.
let since: string | undefined;
try {
  since = requiredFlagValue(argv, '--since');
  if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error(`--since expects YYYY-MM-DD, got "${since}"`);
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
}
const report = await backfillOrders(pool, { apply, since });

console.log(`${report.applied ? 'APPLIED' : 'DRY RUN'} — ${report.since ? `since ${report.since}` : 'no date floor'} — ${report.groups.length} order(s) from ${report.rows} row(s) sharing an AWB:`);
for (const g of report.groups) {
  const perTab = ['bulk', 'specialty'].map((t) => [t, g.rows.filter((r) => r.tab === t).length] as const).filter(([, n]) => n > 0);
  const books = perTab.map(([t, n]) => `${t} ${n}`).join(', ');
  const span = g.date_from === g.date_to ? (g.date_from ?? '?') : `${g.date_from ?? '?'}..${g.date_to ?? '?'}`;
  const who = [g.requested_by && `asked by ${g.requested_by}`, g.logged_by && `logged by ${g.logged_by}`].filter(Boolean).join(', ');
  const client = `${g.client}${g.client_matched_by_name ? ' (client matched by name)' : g.client_id ? '' : ' (no client on file)'}`;
  console.log(`  AWB ${g.awb} · ${client} · ${g.rows.length} rows (${books}) · ${span}${who ? ` · ${who}` : ''} → ${g.number ?? 'would create'}`);
}
console.log(`  skipped ${report.placeholders} row(s) whose AWB is a placeholder (fewer than four digits)`);
if (report.applied) console.log(`created ${report.consignments} consignment(s) for ${report.rows} row(s)`);
else console.log(report.groups.length ? 're-run with --apply to create these orders (one transaction)' : 'nothing to do');
await pool.end();
