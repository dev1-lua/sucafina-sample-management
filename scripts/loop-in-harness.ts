// Keep-in-the-loop harness (feedback #34): drives the REAL agent tools against a LOCAL API and
// checks every branch a chat-supplied name/email can take. Never prod.
// Colleagues use @sucafina.com test addresses: a non-Sucafina email is a CLIENT contact by rule (RC7, 2026-09-09).
// Run: npm run harness:loop-in  (sets API_BASE_URL + API_KEY explicitly — lua-cli env() otherwise
// fills API_KEY from the repo .env, which points at PROD, and the local API rejects that key).
import { execSync } from 'node:child_process';
import UpsertClientTool from '../src/skills/tools/UpsertClientTool';
import CreateSpecialtySampleTool from '../src/skills/tools/CreateSpecialtySampleTool';
import SaveNotifyContactTool from '../src/skills/tools/SaveNotifyContactTool';

if (!/localhost|127\.0\.0\.1/.test(process.env.API_BASE_URL ?? '')) {
  throw new Error('Refusing to run: API_BASE_URL must point at a local API');
}
process.env.API_KEY ??= 'dev-key-sucafina';
const BASE = process.env.API_BASE_URL!;
const HDR = { 'content-type': 'application/json', 'x-api-key': process.env.API_KEY!, 'x-actor': 'loop-in-harness' };
const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...HDR, ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(body)}`);
  return body;
};

const stamp = String(Math.floor(Math.random() * 1e6));
const CLIENT = `Loop Harness Client ${stamp}`;
const TOK = `hloop${stamp}`; // unique word shared by the two ambiguous roster rows
const upsert = new UpsertClientTool();
const spec = new CreateSpecialtySampleTool();
const save = new SaveNotifyContactTool();

let failures = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
};
async function expectThrow(label: string, fn: () => Promise<unknown>, needle: RegExp) {
  try {
    const r = await fn();
    ok(label, false, `expected refusal, got ${JSON.stringify(r).slice(0, 160)}`);
  } catch (e: any) {
    ok(label, needle.test(e.message), e.message.slice(0, 200));
  }
}
const rosterCount = async () => ((await api('/traders?all=1')).data as unknown[]).length;
const newSample = (suffix: string, clientId: string) =>
  spec.execute({ description: `Loop harness ${suffix}`, sample_type: 'offer', receiver_company: CLIENT, name: 'Harness Mark', country: 'Kenya', qty: '300g', client_id: clientId } as any);

const createdSampleIds: string[] = [];
let clientId = '';
try {
  // 0. Client with delivery details but NO account manager.
  const c = await upsert.execute({ name: CLIENT, country: 'Finland', attention_to: 'Ivo', full_address: '1 Harness St, Helsinki', phone: '+358 1', email: `client.${stamp}@example.com` });
  clientId = c.id;
  ok('client created without account manager', !!clientId);

  // 1. Create → gap fires (client has no manager with an email).
  const s1 = await newSample('one', clientId);
  createdSampleIds.push(s1.id);
  ok('gap fires on first sample for an unmanaged client', s1.notify_contact_gap?.client_id === clientId, JSON.stringify(s1.notify_contact_gap));
  ok('ref issued from the restarted counter (SL-7459+, unpadded)', /^SL-7[4-9]\d\d$/.test(s1.ref), s1.ref);

  // 2. Answer "Name, email" → new roster row + client account manager.
  const before = await rosterCount();
  const mgrEmail = `mgr.loop.${stamp}@sucafina.com`;
  const r2 = await save.execute({ name: `Mgr Loop${stamp}`, email: mgrEmail, client: CLIENT });
  ok('name+email → roster row created', r2.matched_by === 'created' && r2.person.email === mgrEmail, JSON.stringify(r2.person));
  const cl = await api(`/clients/${clientId}`);
  ok('client account_owner set to the new person', cl.account_owner?.email === mgrEmail, JSON.stringify(cl.account_owner));
  const s2 = await newSample('two', clientId);
  createdSampleIds.push(s2.id);
  ok('second sample for the same client → NO gap', s2.notify_contact_gap === undefined);
  ok('roster grew by exactly one', (await rosterCount()) === before + 1);

  // 3. Email-only answer → name derived from the address.
  const soloEmail = `loop.harness.${stamp}@sucafina.com`;
  const r3 = await save.execute({ email: soloEmail, sample_ref: s1.ref });
  ok('email-only → created with a derived name', r3.matched_by === 'created' && r3.person.name === 'Loop Harness', JSON.stringify(r3.person));
  ok('email-only → added to the sample', r3.added_to_sample === s1.ref);

  // 4. Same email under a different chat name → same row, no duplicate.
  const n4 = await rosterCount();
  const r4 = await save.execute({ name: 'Someone Else Entirely', email: soloEmail, sample_ref: s1.ref });
  ok('same email, different name → matched by email, no new row', r4.matched_by === 'email' && r4.person.name === 'Loop Harness' && (await rosterCount()) === n4, JSON.stringify(r4.person));
  const row4 = await api(`/specialty-samples/${s1.id}`);
  ok('re-adding the same person does not duplicate notify_trader_ids', new Set(row4.notify_trader_ids).size === row4.notify_trader_ids.length && row4.notify_trader_ids.length === 1, JSON.stringify(row4.notify_trader_ids));

  // 5. Ambiguous first name → refuse and list candidates (not a third row).
  await api('/traders', { method: 'POST', body: JSON.stringify({ name: `${TOK} Alpha`, email: `${TOK}.a@sucafina.com` }) });
  await api('/traders', { method: 'POST', body: JSON.stringify({ name: `${TOK} Beta`, email: `${TOK}.b@sucafina.com` }) });
  const n5 = await rosterCount();
  await expectThrow('ambiguous roster name refused with the candidates listed', () => save.execute({ name: TOK, sample_ref: s1.ref }), new RegExp(`Several people.*${TOK} Alpha.*${TOK} Beta`, 'i'));
  ok('ambiguity created no roster row', (await rosterCount()) === n5);

  // 6. New name, no email → ask for the email once.
  await expectThrow('new person without email → asks for the work email', () => save.execute({ name: `Nobody Known ${stamp}`, sample_ref: s1.ref }), /not on the roster yet.*work email/i);

  // 7. Garbage email → readable schema error (zod) rather than a saved row.
  await expectThrow('invalid email refused', async () => save.execute(save.inputSchema.parse({ email: 'not-an-email', sample_ref: s1.ref })), /email/i);

  // 8. Existing roster short name, no email → appended; exact-name match, email untouched.
  const r8 = await save.execute({ name: `Mgr Loop${stamp}`, sample_ref: s1.ref });
  ok('existing roster name without email → matched by name', r8.matched_by === 'name' && r8.person.email === mgrEmail, JSON.stringify(r8.person));

  // 9. Manager on file WITHOUT an email → gap names them; answering with an email patches THAT row.
  const quiet = await api('/traders', { method: 'POST', body: JSON.stringify({ name: `Quiet Loop${stamp}` }) });
  await api(`/clients/${clientId}`, { method: 'PATCH', body: JSON.stringify({ account_owner_id: quiet.id }) });
  const s9 = await newSample('nine', clientId);
  createdSampleIds.push(s9.id);
  ok('gap fires when the manager has no email, naming them', s9.notify_contact_gap?.account_manager === quiet.name, JSON.stringify(s9.notify_contact_gap));
  const quietEmail = `quiet.loop.${stamp}@sucafina.com`;
  const r9 = await save.execute({ name: quiet.name, email: quietEmail, client: CLIENT });
  const quietNow = ((await api('/traders?all=1')).data as any[]).find((t) => t.id === quiet.id);
  ok('email answer patched onto the existing manager (no rename, no new row)', r9.matched_by === 'name' && quietNow?.email === quietEmail && quietNow?.name === quiet.name, JSON.stringify(quietNow));
  const s9b = await newSample('nine-b', clientId);
  createdSampleIds.push(s9b.id);
  ok('after the patch the gap is closed', s9b.notify_contact_gap === undefined);

  // 10. Send-time recipients: manager + sample loop-ins, each once (manager also on the sample).
  await api(`/clients/${clientId}`, { method: 'PATCH', body: JSON.stringify({ account_owner_id: r2.person ? (await api('/traders?all=1')).data.find((t: any) => t.email === mgrEmail).id : null }) });
  await api(`/specialty-samples/${s1.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'preparing' }) });
  const pending = (await api('/notifications/outbox-pending')).items as any[];
  const prep = pending.find((i) => i.sample_id === s1.id && i.event === 'preparing');
  const names = (prep?.recipients ?? []).map((r: any) => r.name).sort();
  ok('outbox recipients = account manager + sample loop-in, each exactly once', JSON.stringify(names) === JSON.stringify(['Loop Harness', `Mgr Loop${stamp}`].sort()), JSON.stringify(prep?.recipients));
  ok('every recipient carries an email (deliverable)', (prep?.recipients ?? []).every((r: any) => !!r.email));
} catch (e: any) {
  ok('harness ran to completion', false, e.stack ?? e.message);
} finally {
  // Cleanup: soft-delete samples (drops their pending outbox rows), unlink + soft-delete the client,
  // then hard-delete the harness roster rows (no DELETE /traders; clients.account_owner_id is a FK).
  for (const id of createdSampleIds) await api(`/specialty-samples/${id}`, { method: 'DELETE' }).catch(() => {});
  if (clientId) {
    await api(`/clients/${clientId}`, { method: 'PATCH', body: JSON.stringify({ account_owner_id: null }) }).catch(() => {});
    await api(`/clients/${clientId}`, { method: 'DELETE' }).catch(() => {});
  }
  const sql = `UPDATE clients SET account_owner_id = NULL WHERE account_owner_id IN (SELECT id FROM traders WHERE name ILIKE '%${stamp}%' OR name = 'Loop Harness' OR email LIKE '%${stamp}@sucafina.com'); DELETE FROM traders WHERE name ILIKE '%${stamp}%' OR name = 'Loop Harness' OR email LIKE '%${stamp}@sucafina.com';`;
  try {
    execSync(`docker exec sucafina-postgres psql -U sucafina sucafina -c "${sql.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
    console.log('🧹 cleaned up harness samples, client and roster rows');
  } catch (e: any) {
    console.log(`⚠️  roster cleanup failed — run manually:\n${sql}`);
  }
}
console.log(failures ? `\n❌ ${failures} check(s) failed` : '\n✅ all loop-in checks passed');
process.exitCode = failures ? 1 : 0;
