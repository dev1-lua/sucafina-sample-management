// One-shot roster clean-up (RC7, 2026-09-09): customers saved as internal "traders"/account managers.
// Dry run:  npx tsx scripts/fix-roster-externals.ts
// Apply:    npx tsx scripts/fix-roster-externals.ts --apply
// Runs against DATABASE_URL (inside the api container on the VPS: docker compose exec -T api npx tsx scripts/fix-roster-externals.ts --apply).
import { pool } from '../src/db.js';
import { fixRosterExternals } from '../src/lib/roster-externals.js';

const apply = process.argv.includes('--apply');
const report = await fixRosterExternals(pool, { apply, actor: 'script:fix-roster-externals' });
if (!report.found.length) {
  console.log('roster: no external emails on active roster rows — nothing to do');
} else {
  console.log(`${apply ? 'FIXED' : 'DRY RUN — would fix'} ${report.found.length} roster row(s):`);
  for (const t of report.found) {
    console.log(`  - ${t.name} <${t.email}> role=${t.role} → account manager of: ${t.clients.map((c) => c.name).join(', ') || '(none)'}`);
  }
  if (apply) console.log(`unassigned ${report.unassigned} client(s), added ${report.contacts_added} client contact(s), deactivated ${report.deactivated} roster row(s)`);
  else console.log('re-run with --apply to make the change');
}
await pool.end();
