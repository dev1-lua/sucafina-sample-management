// Re-issue the rows that share a ref with a DIFFERENT coffee (the TYPE-113 bug) — round 10, A5.
// Migration 023 listed them in lot_conflicts; the lot keeps the ref on the OLDEST coffee. Every other row gets
// the ref of the lot that already names its coffee, else a fresh counter ref (ONE per coffee across the run) and
// its own lot — plus an `edited` event and a request_edited alert for QC.
// Dry run:  npx tsx scripts/lot-conflicts.ts
// Apply:    npx tsx scripts/lot-conflicts.ts --apply
// Some refs only (dry or apply):  --ref TYPE-113,TYPE-114
// Runs against DATABASE_URL (on the VPS: docker compose … exec -T api npx tsx scripts/lot-conflicts.ts --apply).
import { pool } from '../src/db.js';
import { describeCoffee } from '../src/lib/lots.js';
import { applyLotConflicts, listLotConflicts } from '../src/lib/lot-conflicts.js';

const apply = process.argv.includes('--apply');
const refIdx = process.argv.indexOf('--ref');
const refArg = refIdx >= 0 ? process.argv[refIdx + 1] : process.argv.find((a) => a.startsWith('--ref='))?.slice(6);
const onlyRefs = refArg ? refArg.split(',').map((r) => r.trim()).filter(Boolean) : undefined;
const short = (id: string) => id.slice(0, 8);

const groups = await listLotConflicts(pool, { onlyRefs });
if (!groups.length) {
  console.log('lot_conflicts: empty — nothing to do');
} else {
  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} — ${groups.length} ref(s) with rows naming a different coffee:`);
  for (const g of groups) {
    console.log(`  ${g.ref}  lot = ${g.lot ? `${describeCoffee(g.lot)} (${g.lot.book})` : '(no lot on file)'}`);
    for (const r of g.rows) {
      const coffee = describeCoffee({ book: r.book, outturn: r.outturn, grade: r.grade, quality: r.quality });
      const state = r.live ? `${r.status ?? '?'} ${r.date_on ?? ''}`.trim() : '(deleted)';
      const action = r.live ? 're-issue' : 'drop (row deleted)';
      console.log(`    - ${r.tab.padEnd(9)} ${short(r.sample_id)}  ${(r.receiver ?? '?').padEnd(24)} ${coffee.padEnd(28)} ${state.padEnd(22)} → ${apply ? '' : 'would '}${action}`);
    }
  }
  if (!apply) {
    console.log('re-run with --apply to re-issue these refs (one transaction; QC is alerted per row)');
  } else {
    const report = await applyLotConflicts(pool, { onlyRefs });
    for (const r of report.reissued) console.log(`  re-issued ${r.tab} ${short(r.id)} ${r.receiver ?? '?'}: ${r.from} → ${r.to} (${r.coffee}${r.minted ? '' : ' — existing lot'})`);
    for (const d of report.dropped) console.log(`  dropped   ${d.tab} ${short(d.id)} ${d.ref}: ${d.reason}`);
    console.log(`re-issued ${report.reissued.length} row(s), dropped ${report.dropped.length} stale conflict row(s)`);
  }
}
await pool.end();
