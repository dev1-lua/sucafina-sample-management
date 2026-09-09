import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';
import { parseActor, isQcActor } from '../src/lib/actor.js';

// Migration 017 — Harriet (2026-09-09): "Any changes done from previous requests to be communicated to the
// quality team (i.e. send email warning if a sample gets deleted)." Deletes (by anyone) and edits to a
// sample's REQUEST DEFINITION (by non-QC actors) queue a QC alert on the existing outbox.

beforeAll(async () => {
  await resetDb();
  await request(app).post('/traders').set('x-api-key', API_KEY).send({ name: 'Harriet', email: 'harriet@sucafina.com', role: 'qc' });
  await request(app).post('/traders').set('x-api-key', API_KEY).send({ name: 'Ivo', email: 'ivo@sucafina.com', role: 'trader' });
});

const as = (actor: string) => (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', actor);
const ivo = as('dashboard:Ivo');
const harriet = as('agent:Harriet');
const anon = as('dashboard');

async function makeBulk(quality = 'AB FAQ') {
  const res = await ivo(request(app).post('/bulk-samples')).send({ quality, client: 'Alert Roasters', sample_type: 'type', qty_grams: 300 });
  return res.body.id as string;
}
async function outboxFor(id: string) {
  const { rows } = await pool.query(`SELECT * FROM notifications_outbox WHERE sample_id = $1 ORDER BY created_at`, [id]);
  return rows;
}

describe('actor parsing', () => {
  it('splits surface and name', () => {
    expect(parseActor('dashboard:Ivo Jr.')).toEqual({ surface: 'dashboard', name: 'Ivo Jr.' });
    expect(parseActor('agent:chat')).toEqual({ surface: 'agent', name: null });
    expect(parseActor('dashboard')).toEqual({ surface: 'dashboard', name: null });
    expect(parseActor('job:status-notifier')).toEqual({ surface: 'job', name: 'status-notifier' });
  });

  it('recognises QC roster members by name, case-insensitively, and nobody else', async () => {
    expect(await isQcActor('agent:Harriet')).toBe(true);
    expect(await isQcActor('dashboard:harriet')).toBe(true);
    expect(await isQcActor('dashboard:Ivo')).toBe(false);
    expect(await isQcActor('dashboard')).toBe(false);
    expect(await isQcActor('agent:chat')).toBe(false);
  });
});

describe('deletes → QC alert', () => {
  it('a deleted sample queues one `deleted` row with the actor and supersedes its other pending rows', async () => {
    const id = await makeBulk('Delete me');
    expect((await outboxFor(id)).map((r) => r.event)).toEqual(['created']);
    const del = await ivo(request(app).delete(`/bulk-samples/${id}`));
    expect(del.status).toBe(200);
    const rows = await outboxFor(id);
    const deleted = rows.find((r) => r.event === 'deleted');
    expect(deleted).toBeTruthy();
    expect(deleted.actor).toBe('dashboard:Ivo');
    expect(deleted.sent_at).toBeNull();
    const created = rows.find((r) => r.event === 'created');
    expect(created.sent_at).toBeTruthy();
    expect(created.last_error).toMatch(/superseded/);
  });

  it('outbox-pending returns the deleted sample (with its ref) and outbox-mark accepts it', async () => {
    const id = await makeBulk('Delete then mark');
    await harriet(request(app).delete(`/bulk-samples/${id}`)); // QC deleting still alerts QC
    const pending = await ivo(request(app).get('/notifications/outbox-pending'));
    const item = pending.body.items.find((i: { sample_id: string; event: string }) => i.sample_id === id && i.event === 'deleted');
    expect(item).toBeTruthy();
    expect(item.title).toBe('Delete then mark');
    expect(item.actor).toBe('agent:Harriet');
    expect(item.ref).toMatch(/^TYPE-/);
    const mark = await ivo(request(app).post('/notifications/outbox-mark')).send({ id: item.outbox_id, via: 'email', detail: 'Harriet' });
    expect(mark.status).toBe(200);
    const { rows } = await pool.query(`SELECT type FROM events WHERE entity_id = $1 ORDER BY created_at`, [id]);
    expect(rows.map((r) => r.type)).toContain('email_sent');
  });

  it('client and consignment deletes queue rows on their own tabs and surface in outbox-pending', async () => {
    const c = await anon(request(app).post('/clients')).send({ name: 'Doomed Roasters', country: 'Kenya' });
    await anon(request(app).delete(`/clients/${c.body.id}`));
    const cn = await anon(request(app).post('/consignments')).send({ location: 'Thika' });
    await anon(request(app).delete(`/consignments/${cn.body.id}`));
    const pending = await ivo(request(app).get('/notifications/outbox-pending'));
    const client = pending.body.items.find((i: { sample_id: string }) => i.sample_id === c.body.id);
    expect(client.tab).toBe('client');
    expect(client.event).toBe('deleted');
    expect(client.ref).toBe('Doomed Roasters');
    expect(client.actor).toBe('dashboard');
    const cons = pending.body.items.find((i: { sample_id: string }) => i.sample_id === cn.body.id);
    expect(cons.tab).toBe('consignment');
    expect(cons.ref).toMatch(/^CN-/);
  });

  it('merged-away sources queue a deleted row carrying merged_into', async () => {
    const t = await ivo(request(app).post('/clients')).send({ name: 'Keep Roasters', country: 'Kenya' });
    const s = await ivo(request(app).post('/clients')).send({ name: 'Keep Roasters Ltd', country: 'Kenya' });
    await ivo(request(app).post(`/clients/${t.body.id}/merge`)).send({ source_ids: [s.body.id] });
    const [row] = await outboxFor(s.body.id);
    expect(row.event).toBe('deleted');
    expect(row.payload.merged_into).toBe(t.body.id);
  });
});

describe('edits → QC alert', () => {
  it('a non-QC edit to the request definition queues request_edited with a field diff; each edit is its own row', async () => {
    const id = await makeBulk('Edit me');
    await ivo(request(app).patch(`/bulk-samples/${id}`)).send({ qty_grams: 500, quality: 'AB FAQ PLUS' });
    let rows = (await outboxFor(id)).filter((r) => r.event === 'request_edited');
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe('dashboard:Ivo');
    expect(rows[0].payload.changes).toEqual({ qty_grams: { from: 300, to: 500 }, quality: { from: 'Edit me', to: 'AB FAQ PLUS' } });
    expect(rows[0].dedupe_key).not.toBe('');
    await ivo(request(app).patch(`/bulk-samples/${id}`)).send({ priority: 'urgent' });
    rows = (await outboxFor(id)).filter((r) => r.event === 'request_edited');
    expect(rows).toHaveLength(2);
    expect(rows[1].payload.changes).toEqual({ priority: { from: 'normal', to: 'urgent' } });
  });

  it('QC edits, dispatch/result/comment edits and no-op patches queue nothing', async () => {
    const id = await makeBulk('Quiet');
    await harriet(request(app).patch(`/bulk-samples/${id}`)).send({ qty_grams: 900 });
    await ivo(request(app).patch(`/bulk-samples/${id}`)).send({ comments: 'just a note', location: 'Thika' });
    await ivo(request(app).patch(`/bulk-samples/${id}`)).send({ qty_grams: 900 }); // same value → no change
    await ivo(request(app).patch(`/bulk-samples/${id}`)).send({ status: 'dispatched', courier_norm: 'dhl', awb: '123' });
    await ivo(request(app).patch(`/bulk-samples/${id}`)).send({ result_norm: 'approved' });
    const rows = (await outboxFor(id)).map((r) => r.event);
    expect(rows).not.toContain('request_edited');
    expect(rows).toContain('dispatched');
  });

  it('cancelling a request by a non-QC actor alerts QC; the same on specialty and forwarding', async () => {
    const b = await makeBulk('Cancel me');
    await ivo(request(app).patch(`/bulk-samples/${b}`)).send({ status: 'cancelled' });
    expect((await outboxFor(b)).some((r) => r.event === 'request_edited' && r.payload.changes.status?.to === 'cancelled')).toBe(true);

    const s = await ivo(request(app).post('/specialty-samples')).send({ description: 'AA Sangalai', receiver_company: 'Someone', grade: 'AA' });
    await ivo(request(app).patch(`/specialty-samples/${s.body.id}`)).send({ grade: 'AB' });
    expect((await outboxFor(s.body.id)).find((r) => r.event === 'request_edited').payload.changes).toEqual({ grade: { from: 'AA', to: 'AB' } });

    const f = await ivo(request(app).post('/forwarding-samples')).send({ sender: 'X', origin: 'Uganda', sample_ref: 'UGF/26/1', coffee_quality: 'Robusta', receiver_company: 'Itochu' });
    await ivo(request(app).patch(`/forwarding-samples/${f.body.id}`)).send({ receiver_company: 'Itochu Japan' });
    expect((await outboxFor(f.body.id)).find((r) => r.event === 'request_edited').payload.changes).toEqual({ receiver_company: { from: 'Itochu', to: 'Itochu Japan' } });
  });

  it('outbox-pending carries payload + actor for request_edited rows', async () => {
    const id = await makeBulk('Pending edit');
    await ivo(request(app).patch(`/bulk-samples/${id}`)).send({ qty_grams: 1000 });
    const pending = await ivo(request(app).get('/notifications/outbox-pending'));
    const item = pending.body.items.find((i: { sample_id: string; event: string }) => i.sample_id === id && i.event === 'request_edited');
    expect(item.payload.changes.qty_grams).toEqual({ from: 300, to: 1000 });
    expect(item.actor).toBe('dashboard:Ivo');
  });
});
