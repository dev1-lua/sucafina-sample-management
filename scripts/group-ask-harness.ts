// Group-chat ask harness (v56, the Beyers incident): drives the REAL request_missing_details tool against a
// LOCAL API with an injected conversation and injected delivery, and pins the pure conversation reader.
// Ivo @mentions the bot in a Teams group chat that includes Tommie: "ask Tommie for the Beyers address" —
// the ask must land in THAT chat, addressed to Tommie, with the email leg still going (QC desk copied),
// and the tool must report exactly where it went. Never prod. Run: npm run harness:group-ask
import CreateBulkSampleTool from '../src/skills/tools/CreateBulkSampleTool';
import RequestMissingDetailsTool from '../src/skills/tools/RequestMissingDetailsTool';
import { conversationFromPayload, isGroupConversationId, GROUP_ASKS_ENABLED, type Conversation } from '../src/lib/conversation';
import { persona } from '../src/persona';
import { sampleIntakeSkill } from '../src/skills/sample-intake.skill';

if (!/localhost|127\.0\.0\.1/.test(process.env.API_BASE_URL ?? '')) {
  throw new Error('Refusing to run: API_BASE_URL must point at a local API');
}
process.env.API_KEY ??= 'dev-key-sucafina';
const BASE = process.env.API_BASE_URL!;
const HDR = { 'content-type': 'application/json', 'x-api-key': process.env.API_KEY!, 'x-actor': 'group-ask-harness' };
const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...HDR, ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(body)}`);
  return body;
};

let failures = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
};

// ───────────── 0. the pure reader: what counts as a group conversation
const GROUP_ID = '19:9495c339a1b2c3d4e5f6@thread.v2';
ok('19:…@thread.v2 is a group id', isGroupConversationId(GROUP_ID));
ok('19:…@thread.tacv2 (channel post) is a group id', isGroupConversationId('19:abc@thread.tacv2'));
ok('a:1… (personal chat) is not', !isGroupConversationId('a:1AbCdEf') && !isGroupConversationId(null));
const shapes: Array<[string, unknown, boolean, string | null]> = [
  ['bot framework groupChat', { conversation: { id: GROUP_ID, conversationType: 'groupChat', isGroup: true } }, true, GROUP_ID],
  ['bot framework personal', { conversation: { id: 'a:1xyz', conversationType: 'personal' } }, false, 'a:1xyz'],
  ['personal type wins over a group-shaped id', { conversation: { id: GROUP_ID, conversationType: 'personal' } }, false, GROUP_ID],
  ['wrapped activity', { activity: { conversation: { id: GROUP_ID } } }, true, GROUP_ID],
  ['flat conversationId', { conversationId: GROUP_ID }, true, GROUP_ID],
  ['nothing carried', { text: 'hi' }, false, null],
  ['no payload', undefined, false, null],
];
for (const [label, payload, isGroup, id] of shapes) {
  const c = conversationFromPayload(payload, 'teams');
  ok(`reader: ${label}`, c.isGroup === isGroup && c.conversationId === id, JSON.stringify(c));
}
ok('v56 gate: GROUP_ASKS_ENABLED is a boolean (false until v56)', typeof GROUP_ASKS_ENABLED === 'boolean', String(GROUP_ASKS_ENABLED));

// ───────────── fakes: every send is recorded; nothing touches Teams or email
type Send = { email: string; subject: string; text: string; cc?: string[]; emailOnly?: boolean };
const sends: Send[] = [];
const posts: Array<{ conversationId: string; text: string }> = [];
let mode: 'teams' | 'email' | null = 'teams';
let groupOk = true;
const deliver = async (o: Send) => { sends.push(o); return o.emailOnly ? (mode === null ? null : 'email' as const) : mode; };
const deliverGroup = async (o: { conversationId: string; text: string }) => { posts.push(o); return groupOk; };
const inGroup: Conversation = { channel: 'teams', conversationId: GROUP_ID, isGroup: true, source: 'webhook.conversation' };
const oneToOne: Conversation = { channel: 'teams', conversationId: 'a:1xyz', isGroup: false, source: 'webhook.conversation' };
const tool = (conversation: Conversation, groupAsks = true) =>
  new RequestMissingDetailsTool({ deliver, deliverGroup, conversation: async () => conversation, groupAsks });

const stamp = String(Math.floor(Math.random() * 1e6));
const bulk = new CreateBulkSampleTool();
const created: Array<{ tab: string; id: string }> = [];
const clientIds: string[] = [];
const tommie = `tommie.${stamp}@sucafina.com`;

try {
  // ───────────── 1. Beyers replay in a GROUP chat: the ask lands in the chat, addressed to Tommie, + email
  const row = await bulk.execute({ quality: 'AB FAQ', sample_type: 'type', client: `QA Beyers Group ${stamp}`, country: 'Belgium', qty_grams: 2500 } as any);
  created.push({ tab: 'bulk', id: row.id }); clientIds.push(row.client_id!);
  const r1 = await tool(inGroup).execute({ sample_ref: row.sample_ref, to_name: 'Tommie', to_email: tommie, missing: ['full street address', 'contact person'], note: 'Tommie has it' });
  ok('group: delivered via group', r1.delivered === true && r1.via === 'group', JSON.stringify({ delivered: r1.delivered, via: r1.via }));
  ok('group: reports the conversation it posted into + that it also emailed', (r1 as any).group_conversation === GROUP_ID && (r1 as any).also_emailed === true, JSON.stringify(r1));
  ok('group: one post into THAT conversation', posts.length === 1 && posts[0].conversationId === GROUP_ID, posts[0]?.conversationId);
  ok('group: the post addresses Tommie by name and says what is missing', /^@Tommie — /.test(posts[0]?.text ?? '') && /full street address/.test(posts[0]?.text ?? '') && /contact person/.test(posts[0]?.text ?? ''), (posts[0]?.text ?? '').slice(0, 90));
  ok('group: the post says how to answer (chat @mention or dashboard) and that an email follows', /@mention me/.test(posts[0]?.text ?? '') && /\/clients\//.test(posts[0]?.text ?? '') && /emailing you too/.test(posts[0]?.text ?? ''));
  ok('group: the email leg still goes, email-only (no DM on top of the post)', sends.length === 1 && sends[0].email === tommie && sends[0].emailOnly === true, JSON.stringify({ n: sends.length, emailOnly: sends[0]?.emailOnly }));
  ok('group: email copies the QC desk (logger unknown in harness → QC only)', (sends[0]?.cc ?? []).some((c) => /kenyacof\.specialtyqc@sucafina\.com/.test(c)), JSON.stringify(sends[0]?.cc));
  ok('group: email says REPLY ALL or dashboard link (plain replies are not read)', /REPLY ALL/.test(sends[0]?.text ?? '') && /\/clients\//.test(sends[0]?.text ?? '') && /not read/.test(sends[0]?.text ?? ''));
  const c1 = await api(`/clients/${row.client_id}`);
  ok('group: recorded on the client with via=group', c1.detail_request?.asked_email === tommie && c1.detail_request?.via === 'group' && !!c1.detail_request?.delivered_at, JSON.stringify(c1.detail_request));
  ok('group: Tommie added to the roster with his email', r1.to?.email === tommie);

  // ───────────── 2. the same ask in a 1:1: unchanged — Teams DM (warm) and no group post
  sends.length = 0; posts.length = 0; mode = 'teams';
  const s2 = await bulk.execute({ quality: 'AB FAQ', sample_type: 'type', client: `QA Beyers DM ${stamp}`, country: 'Belgium' } as any);
  created.push({ tab: 'bulk', id: s2.id }); clientIds.push(s2.client_id!);
  const r2 = await tool(oneToOne).execute({ sample_ref: s2.sample_ref, to_email: tommie, missing: ['full street address'] });
  ok('1:1: delivered via teams, nothing posted to any group', r2.delivered === true && r2.via === 'teams' && posts.length === 0 && (r2 as any).group_conversation === undefined, JSON.stringify({ via: r2.via, posts: posts.length }));
  ok('1:1: the DM leg is not email-only', sends.length === 1 && !sends[0].emailOnly);

  // ───────────── 3. group post refused (bot not warm in that chat) → falls back to DM/email, says so honestly
  sends.length = 0; posts.length = 0; groupOk = false; mode = 'email';
  const s3 = await bulk.execute({ quality: 'AB FAQ', sample_type: 'type', client: `QA Beyers Cold ${stamp}`, country: 'Belgium' } as any);
  created.push({ tab: 'bulk', id: s3.id }); clientIds.push(s3.client_id!);
  const r3 = await tool(inGroup).execute({ sample_ref: s3.sample_ref, to_email: tommie, missing: ['full street address'] });
  ok('group post failed → delivered via email (full DM-then-email leg), never claims group', r3.delivered === true && r3.via === 'email' && posts.length === 1 && sends[0]?.emailOnly === false, JSON.stringify({ via: r3.via, emailOnly: sends[0]?.emailOnly }));
  ok('…and the record says email', (await api(`/clients/${s3.client_id}`)).detail_request?.via === 'email');

  // ───────────── 4. group post ok but the email fails → still delivered (group), also_emailed false, recorded as group
  sends.length = 0; posts.length = 0; groupOk = true; mode = null;
  const s4 = await bulk.execute({ quality: 'AB FAQ', sample_type: 'type', client: `QA Beyers NoMail ${stamp}`, country: 'Belgium' } as any);
  created.push({ tab: 'bulk', id: s4.id }); clientIds.push(s4.client_id!);
  const r4 = await tool(inGroup).execute({ sample_ref: s4.sample_ref, to_email: tommie, missing: ['full street address'] });
  ok('group ok + email down → via group, also_emailed=false', r4.delivered === true && r4.via === 'group' && (r4 as any).also_emailed === false, JSON.stringify({ via: r4.via, also: (r4 as any).also_emailed }));

  // ───────────── 5. neither leg works → honest delivered:false, still recorded
  sends.length = 0; posts.length = 0; groupOk = false; mode = null;
  const s5 = await bulk.execute({ quality: 'AB FAQ', sample_type: 'type', client: `QA Beyers Nothing ${stamp}`, country: 'Belgium' } as any);
  created.push({ tab: 'bulk', id: s5.id }); clientIds.push(s5.client_id!);
  const r5 = await tool(inGroup).execute({ sample_ref: s5.sample_ref, to_email: tommie, missing: ['full street address'] });
  ok('nothing delivered → delivered:false with a reason naming the chat, still recorded', r5.delivered === false && r5.via === null && /in this chat/.test(r5.reason ?? '') && r5.recorded === true, JSON.stringify({ via: r5.via, reason: r5.reason }));

  // ───────────── 6. the v56 gate off: a group conversation is treated as a 1:1 (v52 behaviour)
  sends.length = 0; posts.length = 0; groupOk = true; mode = 'teams';
  const s6 = await bulk.execute({ quality: 'AB FAQ', sample_type: 'type', client: `QA Beyers Gated ${stamp}`, country: 'Belgium' } as any);
  created.push({ tab: 'bulk', id: s6.id }); clientIds.push(s6.client_id!);
  const r6 = await tool(inGroup, false).execute({ sample_ref: s6.sample_ref, to_email: tommie, missing: ['full street address'] });
  ok('gate off: no group post, Teams DM as before', r6.via === 'teams' && posts.length === 0, JSON.stringify({ via: r6.via, posts: posts.length }));

  // ───────────── 7. persona + skill carry the rule
  ok('persona: group-chat rule present', /group chat/i.test(persona) && /never say you sent/i.test(persona));
  ok('intake skill: reports via group as "here in the chat"', /here in (this|the) chat/i.test(sampleIntakeSkill.getContext?.() ? String(sampleIntakeSkill.getContext()) : JSON.stringify(sampleIntakeSkill)));
} catch (e: any) {
  failures += 1;
  console.error('❌ harness crashed:', e.stack ?? e.message ?? e);
} finally {
  for (const s of created) await api(`/${s.tab === 'bulk' ? 'bulk-samples' : 'specialty-samples'}/${s.id}`, { method: 'DELETE' }).catch(() => undefined);
  for (const id of clientIds) await api(`/clients/${id}`, { method: 'DELETE' }).catch(() => undefined);
  const roster = await api('/traders?all=1').catch(() => ({ data: [] }));
  for (const t of roster.data ?? []) if (t.email === tommie) await api(`/traders/${t.id}`, { method: 'DELETE' }).catch(() => undefined);
}
console.log(failures ? `\n❌ ${failures} check(s) failed` : '\n✅ all group-ask checks passed');
process.exitCode = failures ? 1 : 0;
