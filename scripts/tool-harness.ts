// Local harness for the agent tools against a LOCAL API (never prod).
// Run: API_BASE_URL=http://localhost:4000 npx tsx scripts/tool-harness.ts
import UpsertClientTool from '../src/skills/tools/UpsertClientTool';
import CreateBulkSampleTool from '../src/skills/tools/CreateBulkSampleTool';
import CreateSpecialtySampleTool from '../src/skills/tools/CreateSpecialtySampleTool';
import SetSamplePriorityTool from '../src/skills/tools/SetSamplePriorityTool';
import FindOpenSamplesTool from '../src/skills/tools/FindOpenSamplesTool';
import RecordDispatchTool from '../src/skills/tools/RecordDispatchTool';

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

// 1. Unknown client → create refuses.
await expectThrow('bulk create for unknown client refused', () => bulk.execute({ quality: 'AB FAQ', sample_type: 'type', client: NEW }), /not in the client book/);

// 2. New client without address → upsert refuses.
await expectThrow('upsert new external client w/o address refused', () => upsert.execute({ name: NEW, attention_to: 'Ivo', phone: '+1 832' }), /full_address/);

// 3. Internal office with just a name is fine.
const office = await upsert.execute({ name: `Sucafina Harness ${stamp}` });
console.log(`✅ internal office added: ${office.name} delivery_address_on_file=${office.delivery_address_on_file}`);

// 4. Full details → ok, then bulk create passes and links client_id + priority urgent.
const c = await upsert.execute({ name: NEW, country: 'USA', attention_to: 'Ivo', full_address: '1 Riverfront Drive, Brooklyn', phone: '+1 832', email: 'ivo@example.com' });
console.log(`✅ new client added: id=${c.id} address_on_file=${c.delivery_address_on_file} contacts=${c.contacts.length}`);
const row = await bulk.execute({ quality: 'AB FAQ', sample_type: 'type', client: NEW, priority: 'urgent' });
console.log(`✅ bulk created: ${row.sample_ref} priority=${row.priority}`);

// 5. Existing client with no address (Folgers-style): create refuses; add address; retry passes.
const NOADDR = `NoAddr Client ${stamp}`;
await fetch(`${process.env.API_BASE_URL}/clients`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.API_KEY!, 'x-actor': 'harness' }, body: JSON.stringify({ name: NOADDR, contact: { attention_to: 'Ivo', phone: '+1' } }) });
await expectThrow('create for existing client w/o address refused', () => spec.execute({ description: 'Nyeri AA', sample_type: 'offer', receiver_company: NOADDR, name: 'Sangalai', country: 'Kenya' } as any), /no full street address/);
const fixed = await upsert.execute({ name: NOADDR, country: 'USA', attention_to: 'ivo', full_address: '2 Some St' });
console.log(`✅ address merged into existing contact: contacts=${fixed.contacts.length} address=${fixed.contacts[0].full_address} phone=${fixed.contacts[0].phone}`);
const s2 = await spec.execute({ description: 'Nyeri AA', sample_type: 'offer', receiver_company: NOADDR, name: 'Sangalai', country: 'Kenya' } as any);
console.log(`✅ specialty created after fix: ${s2.ref} priority=${s2.priority}`);

// 6. Flag priority by ref; open list shows urgent first; dispatch returns address flag false.
const flagged = await prio.execute({ ref: s2.ref, priority: 'urgent' });
console.log(`✅ set_sample_priority: ${flagged.ref} → ${flagged.priority}`);
const list = await open.execute({ query: NOADDR });
console.log(`✅ find_open_samples: first=${list.samples[0]?.ref} priority=${list.samples[0]?.priority}`);
const d = await dispatch.execute({ items: [{ tab: 'specialty', id: s2.id }], courier: 'DHL', awb: '123' });
console.log(`✅ record_dispatch: client_address_missing=${d.updated[0].client_address_missing} priority=${d.updated[0].priority}`);
console.log(process.exitCode ? 'FAILURES' : 'ALL GOOD');
