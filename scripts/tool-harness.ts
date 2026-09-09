// Local harness for the agent tools against a LOCAL API (never prod).
// Run: API_BASE_URL=http://localhost:4000 npx tsx scripts/tool-harness.ts
// 2026-09-09: rewritten for LOG FIRST, COMPLETE LATER — the create tools no longer refuse for missing
// client details (see scripts/log-first-harness.ts for the full replay); this file keeps the merge,
// priority and dispatch checks.
import UpsertClientTool from '../src/skills/tools/UpsertClientTool';
import CreateBulkSampleTool from '../src/skills/tools/CreateBulkSampleTool';
import CreateSpecialtySampleTool from '../src/skills/tools/CreateSpecialtySampleTool';
import SetSamplePriorityTool from '../src/skills/tools/SetSamplePriorityTool';
import FindOpenSamplesTool from '../src/skills/tools/FindOpenSamplesTool';
import RecordDispatchTool from '../src/skills/tools/RecordDispatchTool';
import MergeClientsTool from '../src/skills/tools/MergeClientsTool';

if (!/localhost|127\.0\.0\.1/.test(process.env.API_BASE_URL ?? '')) {
  throw new Error('Refusing to run: API_BASE_URL must point at a local API');
}
process.env.API_KEY ??= 'dev-key-sucafina';

const stamp = String(Math.floor(Math.random() * 1e6));
const NEW = `Harness Client ${stamp}`;
const upsert = new UpsertClientTool();
const bulk = new CreateBulkSampleTool();
const spec = new CreateSpecialtySampleTool();
const prio = new SetSamplePriorityTool();
const open = new FindOpenSamplesTool();
const dispatch = new RecordDispatchTool();
const merge = new MergeClientsTool();

const check = (label: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) process.exitCode = 1;
};
async function expectThrow(label: string, fn: () => Promise<unknown>, needle: RegExp) {
  try {
    const r = await fn();
    console.log(`❌ ${label}: expected refusal, got`, JSON.stringify(r).slice(0, 200));
    process.exitCode = 1;
  } catch (e: any) {
    const ok = needle.test(e.message);
    console.log(`${ok ? '✅' : '❌'} ${label}: ${e.message.slice(0, 160)}`);
    if (!ok) process.exitCode = 1;
  }
}

// 1. Unknown client → sample written, client shell added, gap reported (never a refusal).
const first = await bulk.execute({ quality: 'AB FAQ', sample_type: 'type', client: NEW, country: 'USA' } as any);
check('bulk create for unknown client writes + adds the shell', first.client_created === true && first.client_details_missing.includes('full street address'), first.sample_ref);

// 2. New client without address → upsert adds it and reports the gap.
const partial = await upsert.execute({ name: `Partial Client ${stamp}`, attention_to: 'Ivo', phone: '+1 832' });
check('upsert new external client w/o address is accepted, gap reported', partial.delivery_address_on_file === false && partial.missing_details.includes('full street address'));

// 3. Internal office with just a name is fine.
const office = await upsert.execute({ name: `Sucafina Harness ${stamp}` });
check('internal office added with no gaps', office.delivery_address_on_file === true && office.missing_details.length === 0);

// 4. Full details → address on file; a second bulk create links the same client, priority urgent.
const c = await upsert.execute({ name: NEW, country: 'USA', attention_to: 'Ivo', full_address: '1 Riverfront Drive, Brooklyn', phone: '+1 832', email: 'ivo@example.com' });
check('address saved onto the shell', c.id === first.client_id && c.delivery_address_on_file === true, `contacts=${c.contacts.length}`);
const row = await bulk.execute({ quality: 'AB FAQ', sample_type: 'type', client: NEW, priority: 'urgent' } as any);
check('bulk created for the existing client, no gaps', row.client_created !== true && row.client_details_missing.length === 0 && row.priority === 'urgent', row.sample_ref);

// 5. Existing client with no address (Folgers-style): create still writes; address merges into the same contact.
const NOADDR = `NoAddr Client ${stamp}`;
await fetch(`${process.env.API_BASE_URL}/clients`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.API_KEY!, 'x-actor': 'harness' }, body: JSON.stringify({ name: NOADDR, contact: { attention_to: 'Ivo', phone: '+1' } }) });
const s2 = await spec.execute({ description: 'Nyeri AA', sample_type: 'offer', receiver_company: NOADDR, name: 'Sangalai', country: 'Kenya' } as any);
check('specialty create for a client w/o address writes + flags the gap', !!s2.ref && s2.client_details_missing.includes('full street address'), s2.ref);
const fixed = await upsert.execute({ name: NOADDR, country: 'USA', attention_to: 'ivo', full_address: '2 Some St' });
check('address merged into the existing contact', fixed.contacts.length === 1 && fixed.contacts[0].full_address === '2 Some St' && fixed.contacts[0].phone === '+1');

// 6. Flag priority by ref; open list shows urgent first; dispatch returns address flag false.
const flagged = await prio.execute({ ref: s2.ref, priority: 'urgent' });
check('set_sample_priority', flagged.ref === s2.ref && flagged.priority === 'urgent');
const list = await open.execute({ query: NOADDR });
check('find_open_samples: urgent first, address no longer missing', list.samples[0]?.priority === 'urgent' && list.samples[0]?.address_missing === false, JSON.stringify(list.samples[0]));
const d = await dispatch.execute({ items: [{ tab: 'specialty', id: s2.id }], courier: 'DHL', awb: '123' });
check('record_dispatch: client_address_missing=false', d.updated[0].client_address_missing === false && d.updated[0].priority === 'urgent');

// 7. Merge duplicates (feedback #27): "Paulig"-style dupe folds into the address-bearing entry.
const DUPE = `Harness Client ${stamp} Ltd (NEW) Jan 23`;   // no address, one contact (Sam)
await fetch(`${process.env.API_BASE_URL}/clients`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.API_KEY!, 'x-actor': 'harness' }, body: JSON.stringify({ name: DUPE, contact: { attention_to: 'Sam', email: 'sam@example.com' } }) });
await expectThrow('merge_clients refuses ambiguous name', () => merge.execute({ target: `Harness Client ${stamp}`.slice(0, 12), sources: [DUPE] }), /ambiguous|No client named/);
await expectThrow('merge_clients refuses office↔client', () => merge.execute({ target: NEW, sources: [`Sucafina Harness ${stamp}`] }), /internal Sucafina/);
const m = await merge.execute({ target: NEW, sources: [DUPE] });
console.log(`✅ merge_clients: ${m.summary}`);
console.log(`   contacts_now=${m.contacts_now} address_on_file=${m.delivery_address_on_file} url=${m.url}`);
await expectThrow('merged source is gone from the book', () => merge.execute({ target: NEW, sources: [DUPE] }), /No client named/);
console.log(process.exitCode ? 'FAILURES' : 'ALL GOOD');
