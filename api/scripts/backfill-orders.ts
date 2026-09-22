// Give the rows logged before round 10 their order: live samples that share a real AWB and a client become
// ONE consignment (CN-####) — e.g. Parlor Coffee's three coffees of 2026-09-02 on DHL AWB 8309842892.
// Rows already in an order, groups of one, and placeholder AWBs ("HD", "n/a" — fewer than four digits in a
// row) are left alone. The apply is one transaction; running it twice changes nothing the second time.
// Dry run:  npx tsx scripts/backfill-orders.ts
// Apply:    npx tsx scripts/backfill-orders.ts --apply
// Runs against DATABASE_URL (on the VPS: docker compose … exec -T api npx tsx scripts/backfill-orders.ts --apply).
import { pool } from '../src/db.js';
import { backfillOrders } from '../src/lib/backfill-orders.js';

const apply = process.argv.includes('--apply');
const report = await backfillOrders(pool, { apply });

console.log(`${report.applied ? 'APPLIED' : 'DRY RUN'} — ${report.groups.length} order(s) from ${report.rows} row(s) sharing an AWB:`);
for (const g of report.groups) {
  const perTab = ['bulk', 'specialty'].map((t) => [t, g.rows.filter((r) => r.tab === t).length] as const).filter(([, n]) => n > 0);
  const books = perTab.map(([t, n]) => `${t} ${n}`).join(', ');
  const span = g.date_from === g.date_to ? (g.date_from ?? '?') : `${g.date_from ?? '?'}..${g.date_to ?? '?'}`;
  const who = [g.requested_by && `asked by ${g.requested_by}`, g.logged_by && `logged by ${g.logged_by}`].filter(Boolean).join(', ');
  console.log(`  AWB ${g.awb} · ${g.client} · ${g.rows.length} rows (${books}) · ${span}${who ? ` · ${who}` : ''} → ${g.number ?? 'would create'}`);
}
console.log(`  skipped ${report.placeholders} row(s) whose AWB is a placeholder (fewer than four digits)`);
if (report.applied) console.log(`created ${report.consignments} consignment(s) for ${report.rows} row(s)`);
else console.log(report.groups.length ? 're-run with --apply to create these orders (one transaction)' : 'nothing to do');
await pool.end();
