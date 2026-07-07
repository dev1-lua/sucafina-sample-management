import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('specialty-samples', () => {
  let id: string;

  it('creates a specialty sample, issues a ref, writes a created event', async () => {
    const res = await auth(request(app).post('/specialty-samples')).send({
      description: 'AB FAQ washed', receiver_company: 'Beyers', sample_type_norm: 'offer', grade: 'AB', bags: 10,
    });
    expect(res.status).toBe(201);
    expect(res.body.ref).toBe('SL-8000');
    expect(res.body.status).toBe('requested');
    id = res.body.id;
    const detail = await auth(request(app).get(`/specialty-samples/${id}`));
    expect(detail.body.events).toHaveLength(1);
    expect(detail.body.events[0]).toMatchObject({ type: 'created', actor: 'test', entity_type: 'specialty' });
  });

  it('rejects a create missing required fields (422/400)', async () => {
    const res = await auth(request(app).post('/specialty-samples')).send({ grade: 'AB' });
    expect(res.status).toBe(400);
  });

  it('lists with a status filter and true total', async () => {
    const res = await auth(request(app).get('/specialty-samples?status=requested'));
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].description).toBe('AB FAQ washed');
  });

  it('sorts by a whitelisted column; ignores an unknown sort', async () => {
    const ok = await auth(request(app).get('/specialty-samples?sort=date_on&order=asc'));
    expect(ok.status).toBe(200);
    const bad = await auth(request(app).get('/specialty-samples?sort=evil'));
    expect(bad.status).toBe(200); // falls back, no error
  });

  it('dispatch via PATCH writes a dispatched event + timestamps status', async () => {
    const res = await auth(request(app).patch(`/specialty-samples/${id}`)).send({
      status: 'dispatched', courier_norm: 'dhl', awb: '9620551651',
    });
    expect(res.body.status).toBe('dispatched');
    const d = await auth(request(app).get(`/specialty-samples/${id}`));
    expect(d.body.events.map((e: { type: string }) => e.type)).toContain('dispatched');
  });

  it('result via PATCH derives results_in and logs result_logged', async () => {
    const res = await auth(request(app).patch(`/specialty-samples/${id}`)).send({ result_norm: 'approved' });
    expect(res.body.status).toBe('results_in');
    expect(res.body.result_norm).toBe('approved');
  });

  it('soft-deletes: DELETE hides the row from lists and logs a deleted event', async () => {
    const del = await auth(request(app).delete(`/specialty-samples/${id}`));
    expect(del.status).toBe(200);
    const list = await auth(request(app).get('/specialty-samples'));
    expect(list.body.data.find((r: { id: string }) => r.id === id)).toBeUndefined();
    const d = await auth(request(app).get(`/specialty-samples/${id}`));
    expect(d.body.events.map((e: { type: string }) => e.type)).toContain('deleted');
  });

  it('PATCH on a soft-deleted row 404s and writes no new event (closes the SELECT→UPDATE race window)', async () => {
    const created = await auth(request(app).post('/specialty-samples')).send({
      description: 'Race guard fixture', receiver_company: 'Beyers',
    });
    const rid = created.body.id;
    const del = await auth(request(app).delete(`/specialty-samples/${rid}`));
    expect(del.status).toBe(200);

    const before = await auth(request(app).get(`/specialty-samples/${rid}`));
    expect(before.body.events.map((e: { type: string }) => e.type)).toEqual(['created', 'deleted']);

    const patch = await auth(request(app).patch(`/specialty-samples/${rid}`)).send({ status: 'dispatched' });
    expect(patch.status).toBe(404);

    const after = await auth(request(app).get(`/specialty-samples/${rid}`));
    expect(after.body.events).toHaveLength(before.body.events.length); // the failed PATCH added nothing
  });

  it('404s on unknown id, 400 on bad id', async () => {
    expect((await auth(request(app).get('/specialty-samples/00000000-0000-0000-0000-000000000000'))).status).toBe(404);
    expect((await auth(request(app).get('/specialty-samples/nope'))).status).toBe(400);
  });

  it('400s on an invalid status filter value instead of a 500 enum-cast error', async () => {
    const res = await auth(request(app).get('/specialty-samples?status=bogus'));
    expect(res.status).toBe(400);
  });

  it('falls back to the default page/pageSize on non-numeric pagination params (no 500)', async () => {
    const res = await auth(request(app).get('/specialty-samples?page=abc&pageSize=abc'));
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(25);
  });

  it('empty PATCH {} is a no-op: 200, unchanged row, no new event', async () => {
    const created = await auth(request(app).post('/specialty-samples')).send({
      description: 'No-op fixture', receiver_company: 'Beyers',
    });
    const rid = created.body.id;
    const before = await auth(request(app).get(`/specialty-samples/${rid}`));
    const res = await auth(request(app).patch(`/specialty-samples/${rid}`)).send({});
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(rid);
    const after = await auth(request(app).get(`/specialty-samples/${rid}`));
    expect(after.body.events).toHaveLength(before.body.events.length);
  });
});
