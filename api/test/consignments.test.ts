import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
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
