// Courier tracking harness (Phase 4, Task 4.5): seeds one dispatched Commercial-book row with a DHL
// AWB through the REAL agent tools against a LOCAL API, runs the tracking-sweep job against it
// (TRACKING_STUB_FALLBACK=true on the API gives a deterministic stub answer), then renders
// trackingMessage for a delivered and a customs-exception item and prints both. Never prod.
// Run: npm run harness:tracking
import CreateBulkSampleTool from '../src/skills/tools/CreateBulkSampleTool';
import RecordDispatchTool from '../src/skills/tools/RecordDispatchTool';
import { runTrackingSweep } from '../src/jobs/tracking-sweep.job';
import { trackingMessage } from '../src/jobs/status-notifier.job';
import type { OutboxItem } from '../src/lib/change-alerts';

if (!/localhost|127\.0\.0\.1/.test(process.env.API_BASE_URL ?? '')) {
  throw new Error('Refusing to run: API_BASE_URL must point at a local API');
}
process.env.API_KEY ??= 'dev-key-sucafina';
const BASE = process.env.API_BASE_URL!;
const HDR = { 'content-type': 'application/json', 'x-api-key': process.env.API_KEY!, 'x-actor': 'tracking-harness' };
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

const stamp = String(Math.floor(Math.random() * 1e6));
const bulk = new CreateBulkSampleTool();
const dispatch = new RecordDispatchTool();
const created: Array<{ tab: string; id: string }> = [];
let clientId: string | null = null;

try {
  // ───────────── seed: one dispatched Commercial-book row, DHL, 10-digit AWB
  const row = await bulk.execute({ quality: 'AB FAQ', sample_type: 'type', client: `QA Tracking ${stamp}`, country: 'Kenya', qty_grams: 500 } as any);
  created.push({ tab: 'bulk', id: row.id });
  clientId = row.client_id ?? null;
  const awb = String(Math.floor(1_000_000_000 + Math.random() * 8_999_999_999));
  ok('seed AWB is 10 digits', /^\d{10}$/.test(awb), awb);
  const d = await dispatch.execute({ items: [{ tab: 'bulk', id: row.id }], courier: 'DHL', awb });
  ok('sample dispatched with DHL + AWB', d.updated[0]?.status === 'dispatched' && d.updated[0]?.courier === 'dhl' && d.updated[0]?.awb === awb, JSON.stringify(d.updated[0]));

  // ───────────── runTrackingSweep against the local API (TRACKING_STUB_FALLBACK=true on the server
  // gives every dhl/fedex lookup a deterministic stub answer, so the sweep always finds SOMETHING).
  const result = await runTrackingSweep({ api, limit: 10, minAgeHours: 0 });
  ok('sweep succeeded', result.success === true, JSON.stringify(result));
  ok('sweep checked at least the seeded row', result.checked >= 1, JSON.stringify(result));
  ok('sweep reports no unrecoverable errors', result.errors === 0, JSON.stringify(result));

  // ───────────── render trackingMessage for two fake items (never touches Teams/email)
  const nowIso = new Date().toISOString();
  const fakeDelivered = {
    outbox_id: 'fake-delivered', tab: 'bulk', sample_id: row.id, event: 'delivered', recipient: null,
    ref: 'TYPE-9001', title: 'AB FAQ', receiver: 'Beyers NV', status: 'delivered',
    courier_norm: 'dhl', awb, qty_grams: 500, priority: 'normal',
    requested_by: 'Ivo', logged_by: 'Ivo', client_name: 'Beyers', created_at: nowIso,
    recipients: [{ id: 'r1', name: 'Ivo', email: 'ivo@sucafina.com' }],
    payload: { courier: 'dhl' as const, awb, delivered_at: nowIso, last_event: 'Delivered', location: 'Antwerp, BE' },
  } satisfies OutboxItem;
  const fakeException = {
    outbox_id: 'fake-exception', tab: 'specialty', sample_id: 'fake-id', event: 'tracking_exception', recipient: 'qc',
    ref: 'SL-8123', title: 'AA Nyeri', receiver: 'Folgers', status: 'dispatched',
    courier_norm: 'fedex', awb: '999999999999', qty_grams: 200, priority: 'urgent',
    requested_by: 'Muki', logged_by: 'Muki', client_name: 'Folgers', created_at: nowIso,
    recipients: [],
    dedupe_key: 'customs_hold',
    payload: { courier: 'fedex' as const, awb: '999999999999', reason: 'customs_hold' as const, last_event: 'Held at customs', last_event_at: nowIso, location: 'Memphis, TN' },
  } satisfies OutboxItem;

  const dm = trackingMessage(fakeDelivered);
  const em = trackingMessage(fakeException);
  console.log('\n--- delivered message ---');
  console.log(`subject: ${dm.subject}`);
  console.log(`text:    ${dm.text}`);
  console.log('--- tracking_exception message ---');
  console.log(`subject: ${em.subject}`);
  console.log(`text:    ${em.text}`);

  ok('delivered message names courier + receiver + date', /DHL/.test(dm.text) && /Beyers NV/.test(dm.text) && /delivered to/.test(dm.text), dm.text);
  ok('delivered subject is plain "delivered"', dm.subject === 'Sample TYPE-9001: delivered', dm.subject);
  ok('exception message names reason + location + AWB + last scan', /customs hold/.test(em.text) && /Memphis, TN/.test(em.text) && /999999999999/.test(em.text) && /last scan/.test(em.text), em.text);
  ok('exception subject names the reason', em.subject === 'Sample SL-8123: customs hold', em.subject);
} catch (e: any) {
  failures += 1;
  console.error('❌ harness crashed:', e.stack ?? e.message ?? e);
} finally {
  for (const s of created) await api(`/bulk-samples/${s.id}`, { method: 'DELETE' }).catch(() => undefined);
  if (clientId) await api(`/clients/${clientId}`, { method: 'DELETE' }).catch(() => undefined);
}
console.log(failures ? `\n❌ ${failures} check(s) failed` : '\n✅ all tracking checks passed');
process.exitCode = failures ? 1 : 0;
