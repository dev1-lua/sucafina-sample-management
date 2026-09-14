// LOG FIRST, COMPLETE LATER harness (Beyers, 2026-09-08): drives the REAL agent tools against a LOCAL
// API and replays the failure chain — a sample for an unknown client is written immediately, the missing
// address is routed to the colleague who has it, recorded, chased, and closed when the address lands.
// Never prod. Run: npm run harness:log-first
import UpsertClientTool from '../src/skills/tools/UpsertClientTool';
import FindClientTool from '../src/skills/tools/FindClientTool';
import GetClientTool from '../src/skills/tools/GetClientTool';
import CreateBulkSampleTool from '../src/skills/tools/CreateBulkSampleTool';
import CreateSpecialtySampleTool from '../src/skills/tools/CreateSpecialtySampleTool';
import FindOpenSamplesTool from '../src/skills/tools/FindOpenSamplesTool';
import GetSampleStatusTool from '../src/skills/tools/GetSampleStatusTool';
import RecordDispatchTool from '../src/skills/tools/RecordDispatchTool';
import SaveNotifyContactTool from '../src/skills/tools/SaveNotifyContactTool';
import RequestMissingDetailsTool from '../src/skills/tools/RequestMissingDetailsTool';
import { chasePlan, runDetailsChaser } from '../src/jobs/details-chaser.job';
import pg from 'pg';

if (!/localhost|127\.0\.0\.1/.test(process.env.API_BASE_URL ?? '')) {
  throw new Error('Refusing to run: API_BASE_URL must point at a local API');
}
process.env.API_KEY ??= 'dev-key-sucafina';
const BASE = process.env.API_BASE_URL!;
// Direct DB access only to backdate timestamps the API deliberately never lets a caller set.
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://sucafina:sucafina@localhost:5433/sucafina' });
const HDR = { 'content-type': 'application/json', 'x-api-key': process.env.API_KEY!, 'x-actor': 'log-first-harness' };
const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...HDR, ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(body)}`);
  return body;
};

const stamp = String(Math.floor(Math.random() * 1e6));
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

// Fake delivery: records every send instead of touching Teams/email. `mode` decides what it reports.
const sends: Array<{ email: string; subject: string; text: string; cc?: string[] }> = [];
let mode: 'teams' | 'email' | null = 'email';
const deliver = async (o: { email: string; text: string; subject: string; cc?: string[] }) => { sends.push(o); return mode; };

const upsert = new UpsertClientTool();
const findClient = new FindClientTool();
const getClient = new GetClientTool();
const bulk = new CreateBulkSampleTool();
const spec = new CreateSpecialtySampleTool();
const open = new FindOpenSamplesTool();
const status = new GetSampleStatusTool();
const dispatch = new RecordDispatchTool();
const save = new SaveNotifyContactTool();
const ask = new RequestMissingDetailsTool({ deliver });

const BEYERS = `QA Beyers ${stamp}`;
const created: Array<{ tab: string; id: string }> = [];
const clientIds: string[] = [];

try {
  // ───────────── 0. Before writing (lifecycle sketch 2026-09-14): what the one-line question must cover
  const unknown = await findClient.execute({ query: BEYERS });
  ok('find_client: unknown client → total 0 (address is part of the one-line ask)', unknown.total === 0, JSON.stringify(unknown));

  // ───────────── 1. Beyers replay: unknown client → sample written immediately, gap reported
  const row = await bulk.execute({ quality: 'AB FAQ', sample_type: 'type', client: BEYERS, country: 'Belgium', qty_grams: 2500 } as any);
  created.push({ tab: 'bulk', id: row.id }); clientIds.push(row.client_id!);
  const pre = await getClient.execute({ client_id: row.client_id! });
  ok('get_client: address_missing true + usual_pss_grams null before anything is on file', pre.found === true && pre.address_missing === true && pre.usual_pss_grams === null, JSON.stringify({ a: pre.address_missing, q: pre.usual_pss_grams }));
  const found = await findClient.execute({ query: BEYERS });
  ok('find_client: match carries address_missing', found.matches.find((m: any) => m.id === row.client_id)?.address_missing === true);
  const office = await findClient.execute({ query: 'Sucafina' });
  ok('find_client: internal offices never report address_missing', office.matches.every((m: any) => m.address_missing === false), JSON.stringify(office.matches.slice(0, 3)));
  ok('sample written for an unknown client (no refusal)', !!row.id && row.status === 'requested', row.sample_ref);
  ok('client shell created + linked', row.client_created === true && !!row.client_id);
  ok('gap reported: full street address missing', JSON.stringify(row.client_details_missing) === JSON.stringify(['full street address']), JSON.stringify(row.client_details_missing));
  ok('optional gaps listed (contact person / phone / email)', ['contact person', 'phone', 'email'].every((x) => row.client_details_optional.includes(x)), JSON.stringify(row.client_details_optional));
  ok('client_url returned', /\/clients\//.test(row.client_url ?? ''));

  // "keep tommie@… in the loop, the lab has the address" → route the ask by email
  const tommieEmail = `tommie.${stamp}@sucafina.com`;
  const r1 = await ask.execute({ sample_ref: row.sample_ref, to_name: 'Tommie', to_email: tommieEmail, missing: ['full street address', 'contact person', 'phone'], note: 'the lab has the address' });
  ok('ask delivered via the fake (email)', r1.delivered === true && r1.via === 'email', JSON.stringify(r1));
  ok('ask recorded on the client', r1.recorded === true);
  ok('new person added to the roster with that email', r1.to?.email === tommieEmail && r1.to?.name === 'Tommie', JSON.stringify(r1.to));
  ok('email body says what is missing + how to reply', /full street address/.test(sends[0]?.text ?? '') && /REPLY ALL|Teams/.test(sends[0]?.text ?? ''), (sends[0]?.text ?? '').slice(0, 120));
  ok('QC desk + logger copied (logger unknown in harness → QC only)', (sends[0]?.cc ?? []).some((c) => /specialtyqc@sucafina.com/.test(c)), JSON.stringify(sends[0]?.cc));
  const c1 = await api(`/clients/${row.client_id}`);
  ok('client detail_request names Tommie', c1.detail_request?.asked_name === 'Tommie' && c1.detail_request?.via === 'email', JSON.stringify(c1.detail_request));
  ok('sample timeline has details_requested', ((await api(`/bulk-samples/${row.id}`)).events as any[]).some((e) => e.type === 'details_requested'));

  // open list + status carry the flag
  const list = await open.execute({ query: BEYERS });
  const hit = list.samples.find((s: any) => s.id === row.id);
  ok('find_open_samples flags address_missing + who was asked', hit?.address_missing === true && hit?.details_requested_from === 'Tommie', JSON.stringify(hit));
  const st = await status.execute({ ref_or_id: row.sample_ref });
  ok('get_sample_status carries the gap', st.client_address_missing === true && st.details_requested_from === 'Tommie');

  // second ask for the same sample → still one open request
  const r2 = await ask.execute({ sample_ref: row.sample_ref, to_email: tommieEmail, missing: ['full street address'] });
  ok('second ask upserts (still one open request)', r2.recorded === true && (await api(`/clients/${row.client_id}`)).detail_request?.asked_email === tommieEmail);

  // address lands → gap closes everywhere
  const fixed = await upsert.execute({ name: BEYERS, attention_to: 'Thomas P', full_address: 'Koning Leopoldlaan 3, 2870 Puurs', phone: '+32 52 30 00 30' });
  ok('upsert_client saves the address (no refusal), reports nothing missing', fixed.delivery_address_on_file === true && fixed.missing_details.length === 0, JSON.stringify(fixed.missing_details));
  ok('open ask resolved', (await api(`/clients/${row.client_id}`)).detail_request === null);
  const list2 = await open.execute({ query: BEYERS });
  ok('find_open_samples no longer flags it', list2.samples.find((s: any) => s.id === row.id)?.address_missing === false);
  ok('get_client: address_missing false once saved', (await getClient.execute({ client_id: row.client_id! })).address_missing === false);
  ok('get_client: usual_pss_grams stays null (this was a Type, not a PSS)', (await getClient.execute({ client_id: row.client_id! })).usual_pss_grams === null);

  // ───────────── 1b. Awaiting collection: the AWB lands first (dashboard style), the pickup later
  await api(`/bulk-samples/${row.id}`, { method: 'PATCH', body: JSON.stringify({ awb: '1471098930', courier_norm: 'dhl' }) });
  const waiting = (await open.execute({ query: BEYERS })).samples.find((s: any) => s.id === row.id);
  ok('find_open_samples: AWB on file + still requested → awaiting_collection true', waiting?.awaiting_collection === true && waiting?.status === 'requested', JSON.stringify({ s: waiting?.status, w: waiting?.awaiting_collection }));
  ok('get_sample_status carries awaiting_collection', (await status.execute({ ref_or_id: row.sample_ref })).awaiting_collection === true);
  // Read the outbox table directly: /outbox-pending is capped at 100 rows and the dev DB carries leftovers.
  const outbox = async () => (await db.query(`SELECT event, sent_at, last_error FROM notifications_outbox WHERE sample_id = $1 ORDER BY created_at`, [row.id])).rows as Array<{ event: string; sent_at: string | null; last_error: string | null }>;
  const queued = (await outbox()).filter((r) => !r.sent_at).map((r) => r.event);
  ok('outbox: awb_added queued (created too)', queued.includes('awb_added') && queued.includes('created'), queued.join(','));
  const d = await dispatch.execute({ items: [{ tab: 'bulk', id: row.id }] });
  ok('record_dispatch with no courier/AWB keeps the ones on file', d.updated[0].courier === 'dhl' && d.updated[0].awb === '1471098930', JSON.stringify(d.updated[0]));
  ok('record_dispatch: address no longer missing', d.updated[0].client_address_missing === false);
  ok('after pickup: awaiting_collection false', (await status.execute({ ref_or_id: row.sample_ref })).awaiting_collection === false);
  const after = await outbox();
  const awbRow = after.find((r) => r.event === 'awb_added');
  ok('outbox: dispatch superseded the pending awb_added (one ping, not two)', after.some((r) => r.event === 'dispatched' && !r.sent_at) && !!awbRow?.sent_at && awbRow?.last_error === 'superseded: dispatched', JSON.stringify(after));
  const ev = ((await api(`/bulk-samples/${row.id}`)).events as any[]).map((e) => e.type);
  ok('timeline: details_requested → details_resolved', ev.indexOf('details_requested') >= 0 && ev.indexOf('details_resolved') > ev.indexOf('details_requested'), ev.join(','));
  await expectThrow('asking again once the address is on file is refused', () => ask.execute({ sample_ref: row.sample_ref, missing: ['x'] }), /already has|nothing to ask/i);

  // ───────────── 2. "ask Tommie" with a name that is NOT on the roster and no email
  const s2 = await bulk.execute({ quality: 'ABC FAQ', sample_type: 'type', client: `QA NoEmail ${stamp}`, country: 'Belgium' } as any);
  created.push({ tab: 'bulk', id: s2.id }); clientIds.push(s2.client_id!);
  const r3 = await ask.execute({ sample_ref: s2.sample_ref, to_name: `Unknownperson${stamp}`, missing: ['full street address'] });
  ok('unknown name → needs_email, nothing sent, still recorded', r3.delivered === false && r3.needs_email === true && r3.recorded === true, JSON.stringify(r3));
  ok('recorded with nobody asked', (await api(`/clients/${s2.client_id}`)).detail_request?.asked_name == null);

  // ───────────── 3. a CLIENT's email is never a colleague
  const r4 = await ask.execute({ sample_ref: s2.sample_ref, to_email: `buyer.${stamp}@nestle.com`, missing: ['full street address'] });
  ok('external email refused as recipient', r4.delivered === false && /client|customer/i.test(r4.reason ?? ''), JSON.stringify(r4));
  const rosterBefore = ((await api('/traders?all=1')).data as any[]).length;
  const sv = await save.execute({ email: `buyer.${stamp}@nestle.com`, client: `QA NoEmail ${stamp}` });
  ok('save_notify_contact with a client email → saved as CLIENT CONTACT, not roster', sv.saved_as === 'client_contact', JSON.stringify(sv));
  ok('roster unchanged', ((await api('/traders?all=1')).data as any[]).length === rosterBefore);
  ok('email now on the client', ((await api(`/clients/${s2.client_id}`)).contacts as any[]).some((c) => c.email === `buyer.${stamp}@nestle.com`));

  // ───────────── 4. nobody named → chain: Sales Trader (≠ logger) → account manager → nobody
  const muki = await api('/traders', { method: 'POST', body: JSON.stringify({ name: `Muki${stamp}`, email: `muki.${stamp}@sucafina.com`, role: 'trader', active: true }) });
  const s3 = await bulk.execute({ quality: 'PB', sample_type: 'offer', client: `QA Chain ${stamp}`, country: 'Kenya', requested_by: `Muki${stamp}` } as any);
  created.push({ tab: 'bulk', id: s3.id }); clientIds.push(s3.client_id!);
  sends.length = 0;
  const r5 = await ask.execute({ sample_ref: s3.sample_ref, missing: ['full street address'] });
  ok('chain picks the Sales Trader when nobody is named', r5.delivered === true && r5.to?.email === `muki.${stamp}@sucafina.com`, JSON.stringify(r5.to));
  const s4 = await bulk.execute({ quality: 'PB', sample_type: 'offer', client: `QA Chain2 ${stamp}`, country: 'Kenya' } as any);
  created.push({ tab: 'bulk', id: s4.id }); clientIds.push(s4.client_id!);
  await save.execute({ email: `am.${stamp}@sucafina.com`, client: `QA Chain2 ${stamp}` });
  const r6 = await ask.execute({ sample_ref: s4.sample_ref, missing: ['full street address'] });
  ok('chain falls back to the account manager', r6.delivered === true && r6.to?.email === `am.${stamp}@sucafina.com`, JSON.stringify(r6.to));
  const s5 = await bulk.execute({ quality: 'PB', sample_type: 'offer', client: `QA Chain3 ${stamp}`, country: 'Kenya' } as any);
  created.push({ tab: 'bulk', id: s5.id }); clientIds.push(s5.client_id!);
  const r7 = await ask.execute({ sample_ref: s5.sample_ref, missing: ['full street address'] });
  ok('nobody to ask → recorded only, delivered false, honest reason', r7.delivered === false && r7.recorded === true && r7.to === null, JSON.stringify(r7));

  // ───────────── 5. Connect Coffee: existing client WITH address, no phone → optional only
  const cc = await upsert.execute({ name: `QA Connect ${stamp}`, country: 'Kenya', attention_to: 'Stein', full_address: 'The Riverfront, Westlands' });
  clientIds.push(cc.id);
  ok('upsert_client reports phone/email as optional gaps only', cc.missing_details.length === 0 && cc.optional_missing.includes('phone'), JSON.stringify(cc));
  const s6 = await bulk.execute({ quality: 'AA FAQ', sample_type: 'offer', client: `QA Connect ${stamp}`, country: 'Kenya', courier: 'rider' } as any);
  created.push({ tab: 'bulk', id: s6.id });
  ok('create: nothing blocking, phone optional', s6.client_details_missing.length === 0 && s6.client_details_optional.includes('phone') && s6.client_created !== true);
  const cc2 = await upsert.execute({ name: `QA Connect ${stamp}`, attention_to: 'Stein', phone: '+254 717' });
  ok('phone merges into the existing contact (no duplicate)', cc2.contacts.length === 1 && cc2.contacts[0].phone === '+254 717' && cc2.contacts[0].full_address === 'The Riverfront, Westlands');

  // ───────────── 6. Sucafina Argentina: internal office, no questions, shell created
  const s7 = await spec.execute({ description: 'AA Sangalai', sample_type: 'offer', receiver_company: `Sucafina Argentina ${stamp}`, name: 'Sangalai', country: 'Kenya' } as any);
  created.push({ tab: 'specialty', id: s7.id }); clientIds.push(s7.client_id!);
  ok('internal office: shell created, no gaps', s7.client_created === true && s7.client_details_missing.length === 0 && s7.client_details_optional.length === 0, JSON.stringify([s7.client_details_missing, s7.client_details_optional]));

  // ───────────── 7. ambiguous receiver still asks
  await api('/clients', { method: 'POST', body: JSON.stringify({ name: `Ambig Roasters ${stamp}` }) });
  await api('/clients', { method: 'POST', body: JSON.stringify({ name: `Ambig Roasters ${stamp} Ltd` }) });
  await expectThrow('several matching clients → ask which one (no write)', () => bulk.execute({ quality: 'AB', sample_type: 'type', client: `Roasters ${stamp}` } as any), /Several clients match/);

  // ───────────── 8. save_notify_contact before the client exists
  const sv2 = await save.execute({ email: `newam.${stamp}@sucafina.com`, client: `QA Fresh ${stamp}` });
  ok('loop-in for a client not yet in the book creates the shell', sv2.saved === true && sv2.client_created === true && sv2.account_manager_for_client === `QA Fresh ${stamp}`, JSON.stringify(sv2));

  // ───────────── 9. regression: known client with address + manager → nothing new fires
  const known = await upsert.execute({ name: `QA Known ${stamp}`, country: 'Finland', attention_to: 'Ann', full_address: '1 Known St', phone: '+358', email: `known.${stamp}@example.com` });
  clientIds.push(known.id);
  await save.execute({ email: `knownam.${stamp}@sucafina.com`, client: `QA Known ${stamp}` });
  const s8 = await bulk.execute({ quality: 'AB FAQ', sample_type: 'type', client: `QA Known ${stamp}`, country: 'Finland' } as any);
  created.push({ tab: 'bulk', id: s8.id });
  ok('happy path unchanged: no shell, no gaps, no loop-in question', s8.client_created !== true && s8.client_details_missing.length === 0 && s8.notify_contact_gap === undefined, JSON.stringify(s8.notify_contact_gap));

  // ───────────── 10. the daily chase: plan + a dry run with the fake deliver
  const planA = chasePlan({ chase_count: 0, asked_email: 'a@sucafina.com', asked_name: 'A', asked_by_email: 'b@sucafina.com', account_manager: { name: 'C', email: 'c@sucafina.com' } } as any);
  ok('chase #1 nudges only the asked person', planA.recipients.map((r) => r.email).join() === 'a@sucafina.com' && planA.escalate === false, JSON.stringify(planA));
  const planB = chasePlan({ chase_count: 2, asked_email: 'a@sucafina.com', asked_name: 'A', asked_by_email: 'b@sucafina.com', account_manager: { name: 'C', email: 'c@sucafina.com' } } as any);
  ok('chase #3 escalates to asked + logger + account manager', planB.escalate === true && planB.recipients.map((r) => r.email).sort().join() === 'a@sucafina.com,b@sucafina.com,c@sucafina.com', JSON.stringify(planB));
  const planC = chasePlan({ chase_count: 0, asked_email: null, asked_name: null, asked_by_email: 'b@sucafina.com', account_manager: null } as any);
  ok('nobody asked → straight to the logger', planC.recipients.map((r) => r.email).join() === 'b@sucafina.com' && planC.escalate === true);
  sends.length = 0; mode = 'email';
  // Asks delivered minutes ago are not due (20h spacing) — backdate the two delivered ones, then run.
  const run0 = await runDetailsChaser({ deliver });
  ok('freshly delivered asks are not chased again the same day', run0.chased === 0, JSON.stringify(run0));
  await db.query(`UPDATE client_detail_requests SET delivered_at = now() - interval '21 hours', last_chased_at = NULL WHERE client_id = ANY($1::uuid[])`, [[s3.client_id, s4.client_id]]);
  const run = await runDetailsChaser({ deliver });
  ok('details-chaser run: chased the two backdated asks (Muki chain, AM chain)', run.chased === 2, JSON.stringify(run));
  ok('chase went to the asked person only (chase #1)', sends.length === 2 && sends.every((x) => /sucafina\.com$/.test(x.email)) && /Still needed for/.test(sends[0]!.text), JSON.stringify(sends.map((x) => x.email)));
  const afterChase = (await api(`/clients/${s3.client_id}`)).detail_request;
  ok('chase stamped chase_count on the open ask', afterChase?.chase_count === 1, JSON.stringify(afterChase));
  const run2 = await runDetailsChaser({ deliver });
  ok('second run within 20h chases nothing', run2.chased === 0, JSON.stringify(run2));
  // Two unanswered nudges → escalation to the logger + account manager as well.
  await db.query(`UPDATE client_detail_requests SET chase_count = 2, last_chased_at = now() - interval '21 hours' WHERE client_id = $1`, [s4.client_id]);
  sends.length = 0;
  const run3 = await runDetailsChaser({ deliver });
  const esc = (await api(`/clients/${s4.client_id}`)).detail_request;
  ok('third chase escalates (asked person + account manager; logger is external here) and stamps escalated_at', run3.chased === 1 && !!esc?.escalated_at && sends.length === 1, JSON.stringify({ run3, sends: sends.map((x) => x.email) }));
} catch (e) {
  failures += 1;
  console.error('❌ harness crashed:', e);
} finally {
  // Cleanup: soft-delete harness samples and clients (audit rows stay, which is fine locally).
  for (const s of created) await api(`/${s.tab === 'bulk' ? 'bulk-samples' : s.tab === 'specialty' ? 'specialty-samples' : 'forwarding-samples'}/${s.id}`, { method: 'DELETE' }).catch(() => undefined);
  for (const id of clientIds) if (id) await api(`/clients/${id}`, { method: 'DELETE' }).catch(() => undefined);
  await db.end().catch(() => undefined);
}
console.log(failures ? `FAILURES: ${failures}` : 'ALL GOOD');
process.exitCode = failures ? 1 : 0;
