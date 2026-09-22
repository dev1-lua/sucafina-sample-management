import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('consignments', () => {
  let cid: string;
  let sampleId: string;

  it('mints a CN number on create and logs a created event', async () => {
    const res = await auth(request(app).post('/consignments')).send({ location: 'thika', notes: 'Sept dispatch' });
    expect(res.status).toBe(201);
    expect(res.body.number).toMatch(/^CN-\d+$/);
    expect(res.body.location).toBe('thika');
    expect(res.body.status).toBe('open');
    cid = res.body.id;
    const d = await auth(request(app).get(`/consignments/${cid}`));
    expect(d.body.member_count).toBe(0);
    expect(d.body.events[0]).toMatchObject({ type: 'created', entity_type: 'consignment' });
  });

  it('groups samples and reflects them as members', async () => {
    const s = await auth(request(app).post('/bulk-samples')).send({ quality: 'AA', client: 'Paulig', sample_type: 'pss' });
    sampleId = s.body.id;
    const add = await auth(request(app).post(`/consignments/${cid}/samples`)).send({ tab: 'bulk', ids: [sampleId] });
    expect(add.body.added).toBe(1);
    const d = await auth(request(app).get(`/consignments/${cid}`));
    expect(d.body.member_count).toBe(1);
    expect(d.body.members[0]).toMatchObject({ tab: 'bulk', id: sampleId });
    // The sample detail now surfaces its consignment number.
    const sd = await auth(request(app).get(`/bulk-samples/${sampleId}`));
    expect(sd.body.consignment_number).toBe(d.body.number);
    expect(sd.body.consignment_location).toBe('thika');
  });

  it('sets the consignment location via PATCH', async () => {
    const res = await auth(request(app).patch(`/consignments/${cid}`)).send({ location: 'westlands', status: 'dispatched' });
    expect(res.body.location).toBe('westlands');
    expect(res.body.status).toBe('dispatched');
  });

  it('lists consignments with a member count and location filter', async () => {
    const all = await auth(request(app).get('/consignments'));
    expect(all.body.total).toBeGreaterThanOrEqual(1);
    const filtered = await auth(request(app).get('/consignments?location=Westlands'));
    expect(filtered.body.data.every((c: { location: string }) => c.location === 'westlands')).toBe(true);
  });

  it('removes a sample from the consignment', async () => {
    const res = await auth(request(app).delete(`/consignments/${cid}/samples`)).send({ tab: 'bulk', ids: [sampleId] });
    expect(res.body.removed).toBe(1);
    const sd = await auth(request(app).get(`/bulk-samples/${sampleId}`));
    expect(sd.body.consignment_number).toBeNull();
  });

  it('soft-deletes and detaches remaining members', async () => {
    await auth(request(app).post(`/consignments/${cid}/samples`)).send({ tab: 'bulk', ids: [sampleId] });
    const del = await auth(request(app).delete(`/consignments/${cid}`));
    expect(del.body.ok).toBe(true);
    const sd = await auth(request(app).get(`/bulk-samples/${sampleId}`));
    expect(sd.body.consignment_number).toBeNull();
    expect((await auth(request(app).get(`/consignments/${cid}`))).status).toBe(404);
  });
});

// Round 10: a consignment is the ORDER — one request, one client, several sends (contracts §6).
describe('consignments as orders (round 10)', () => {
  const harriet = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'dashboard:Harriet');
  let clientId: string;
  let orderId: string;
  let orderNumber: string;
  let bulkId: string;
  let specId: string;

  beforeAll(async () => {
    clientId = (await auth(request(app).post('/clients')).send({ name: 'EDMAX', country: 'Belgium' })).body.id;
    bulkId = (await auth(request(app).post('/bulk-samples')).send({ quality: 'AB FAQ', client: 'EDMAX', client_id: clientId, sample_type: 'type', qty_grams: 300, country: 'Belgium' })).body.id;
    specId = (await auth(request(app).post('/specialty-samples')).send({ description: 'Nyeri AA', receiver_company: 'EDMAX', client_id: clientId, outturn: '15/5670', grade: 'AA', sample_type_norm: 'offer', qty_grams: 250 })).body.id;
  });

  it('creates an order with its client, requester, logger and samples in one go', async () => {
    const res = await auth(request(app).post('/consignments')).send({
      location: 'westlands', client_id: clientId, requested_by: 'Ivo', logged_by: 'Harriet',
      samples: [{ tab: 'bulk', id: bulkId }, { tab: 'specialty', id: specId }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ client_id: clientId, requested_by: 'Ivo', logged_by: 'Harriet', member_count: 2 });
    orderId = res.body.id;
    orderNumber = res.body.number;
    const d = await auth(request(app).get(`/consignments/${orderId}`));
    expect(d.body).toMatchObject({ client_name: 'EDMAX', derived_status: 'requested', member_count: 2 });
    expect(d.body.members).toHaveLength(2);
    const spec = d.body.members.find((m: { tab: string }) => m.tab === 'specialty');
    expect(spec).toMatchObject({ id: specId, outturn: '15/5670', grade: 'AA', sample_type_norm: 'offer', qty_grams: 250, awb: null, courier_norm: null, dispatched_on: null });
    expect(typeof spec.date_on).toBe('string');
    const bulk = d.body.members.find((m: { tab: string }) => m.tab === 'bulk');
    expect(bulk).toMatchObject({ id: bulkId, outturn: null, grade: null, sample_type_norm: 'type', qty_grams: 300 });
    expect((await auth(request(app).get(`/bulk-samples/${bulkId}`))).body.consignment_number).toBe(orderNumber);
  });

  it('attaching updates the still-pending created outbox rows with the order', async () => {
    const { rows } = await pool.query(
      `SELECT tab, payload FROM notifications_outbox WHERE event = 'created' AND sent_at IS NULL AND sample_id = ANY($1::uuid[]) ORDER BY tab`,
      [[bulkId, specId]],
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.payload).toMatchObject({ consignment_id: orderId, consignment_number: orderNumber });
    // A sample created WITH the order carries it from the start (contracts §4/§8).
    const born = await auth(request(app).post('/bulk-samples')).send({ quality: 'PB', client: 'EDMAX', client_id: clientId, sample_type: 'offer', consignment_id: orderId });
    expect(born.status).toBe(201);
    expect(born.body.consignment_id).toBe(orderId);
    const { rows: [ob] } = await pool.query(`SELECT payload FROM notifications_outbox WHERE event = 'created' AND sample_id = $1`, [born.body.id]);
    expect(ob.payload).toMatchObject({ consignment_id: orderId, consignment_number: orderNumber });
    await auth(request(app).delete(`/consignments/${orderId}/samples`)).send({ tab: 'bulk', ids: [born.body.id] });
    const { rows: [after] } = await pool.query(`SELECT payload FROM notifications_outbox WHERE event = 'created' AND sample_id = $1`, [born.body.id]);
    expect(after.payload).toBeNull();
    // Unknown / deleted order on create → 400.
    expect((await auth(request(app).post('/bulk-samples')).send({ quality: 'PB', client: 'EDMAX', consignment_id: '00000000-0000-0000-0000-000000000000' })).status).toBe(400);
  });

  it('deleting the order clears it from the members\' still-pending created pings', async () => {
    const c = await auth(request(app).post('/consignments')).send({ client_id: clientId });
    const born = await auth(request(app).post('/bulk-samples')).send({ quality: 'PB', client: 'EDMAX', client_id: clientId, sample_type: 'offer', consignment_id: c.body.id });
    expect(born.status).toBe(201);
    await auth(request(app).delete(`/consignments/${c.body.id}`));
    const { rows: [after] } = await pool.query(`SELECT payload FROM notifications_outbox WHERE event = 'created' AND sample_id = $1`, [born.body.id]);
    expect(after.payload).toBeNull();
    expect((await auth(request(app).get(`/bulk-samples/${born.body.id}`))).body.consignment_number).toBeNull();
  });

  it('lists with client_name + derived_status and filters by book / client_id / q (client name)', async () => {
    const all = await auth(request(app).get('/consignments'));
    const row = all.body.data.find((c: { id: string }) => c.id === orderId);
    expect(row).toMatchObject({ client_name: 'EDMAX', derived_status: 'requested', member_count: 2 });
    expect((await auth(request(app).get('/consignments?book=commercial'))).body.data.map((c: { id: string }) => c.id)).toContain(orderId);
    expect((await auth(request(app).get('/consignments?book=forwarding'))).body.data.map((c: { id: string }) => c.id)).not.toContain(orderId);
    expect((await auth(request(app).get('/consignments?book=nope'))).status).toBe(400);
    expect((await auth(request(app).get(`/consignments?client_id=${clientId}`))).body.data.map((c: { id: string }) => c.id)).toEqual([orderId]);
    expect((await auth(request(app).get('/consignments?q=edm'))).body.data.map((c: { id: string }) => c.id)).toEqual([orderId]);
  });

  it('derived_status moves partly_dispatched → dispatched → delivered → closed', async () => {
    await auth(request(app).patch(`/bulk-samples/${bulkId}`)).send({ awb: '1234567890' });
    expect((await auth(request(app).get(`/consignments/${orderId}`))).body.derived_status).toBe('partly_dispatched');
    await auth(request(app).patch(`/specialty-samples/${specId}`)).send({ status: 'dispatched', courier_norm: 'dhl', awb: '1234567890' });
    expect((await auth(request(app).get(`/consignments/${orderId}`))).body.derived_status).toBe('dispatched');
    await auth(request(app).patch(`/bulk-samples/${bulkId}`)).send({ status: 'delivered' });
    await auth(request(app).patch(`/specialty-samples/${specId}`)).send({ status: 'delivered' });
    expect((await auth(request(app).get(`/consignments/${orderId}`))).body.derived_status).toBe('delivered');
    await auth(request(app).patch(`/consignments/${orderId}`)).send({ status: 'closed' });
    expect((await auth(request(app).get(`/consignments/${orderId}`))).body.derived_status).toBe('closed');
  });

  it('POST /:id/dispatch applies the per-sample dispatch write to every live member', async () => {
    const c = await auth(request(app).post('/consignments')).send({ client_id: clientId, requested_by: 'Ivo' });
    const a = (await auth(request(app).post('/bulk-samples')).send({ quality: 'AA', client: 'EDMAX', client_id: clientId, sample_type: 'offer', requested_by: 'Ivo', stock_grams: 1000, qty_grams: 300, consignment_id: c.body.id })).body;
    const b = (await auth(request(app).post('/specialty-samples')).send({ description: 'Kiambu AB', receiver_company: 'EDMAX', client_id: clientId, requested_by: 'Ivo', consignment_id: c.body.id })).body;
    const f = (await auth(request(app).post('/forwarding-samples')).send({ sender: 'Sucafina Kenya', origin: 'Kenya', sample_ref: 'FWD-1', coffee_quality: 'AA', receiver_company: 'EDMAX', consignment_id: c.body.id })).body;
    const cancelled = (await auth(request(app).post('/bulk-samples')).send({ quality: 'PB', client: 'EDMAX', sample_type: 'offer', consignment_id: c.body.id })).body;
    await auth(request(app).patch(`/bulk-samples/${cancelled.id}`)).send({ status: 'cancelled' });

    const res = await harriet(request(app).post(`/consignments/${c.body.id}/dispatch`)).send({ courier: 'dhl', awb: '9876543210', dispatched_on: '2026-09-20' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 3 });

    const ad = (await auth(request(app).get(`/bulk-samples/${a.id}`))).body;
    expect(ad).toMatchObject({ status: 'dispatched', courier_norm: 'dhl', awb: '9876543210', dispatched_on: '2026-09-20', completed_by: 'Harriet', stock_grams: 700 });
    expect(ad.events.map((e: { type: string }) => e.type)).toContain('dispatched');
    expect((await auth(request(app).get(`/specialty-samples/${b.id}`))).body).toMatchObject({ status: 'dispatched', awb: '9876543210', completed_by: 'Harriet' });
    expect((await auth(request(app).get(`/forwarding-samples/${f.id}`))).body).toMatchObject({ status: 'dispatched', awb: '9876543210' });
    expect((await auth(request(app).get(`/bulk-samples/${cancelled.id}`))).body.status).toBe('cancelled');
    const { rows } = await pool.query(`SELECT sample_id FROM notifications_outbox WHERE event = 'dispatched' AND sample_id = ANY($1::uuid[])`, [[a.id, b.id, f.id]]);
    expect(rows).toHaveLength(3);
    const order = (await auth(request(app).get(`/consignments/${c.body.id}`))).body;
    expect(order.derived_status).toBe('dispatched');
    expect(order.status).toBe('dispatched');
    expect(order.events.map((e: { type: string }) => e.type)).toContain('dispatched');
    expect((await auth(request(app).post(`/consignments/${c.body.id}/dispatch`)).send({ courier: 'dhl' })).status).toBe(400);
    expect((await auth(request(app).post('/consignments/00000000-0000-0000-0000-000000000000/dispatch')).send({ courier: 'dhl', awb: '1' })).status).toBe(404);
  });
});
