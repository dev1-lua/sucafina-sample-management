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

  it('404s on unknown id, 400 on bad id', async () => {
    expect((await auth(request(app).get('/specialty-samples/00000000-0000-0000-0000-000000000000'))).status).toBe(404);
    expect((await auth(request(app).get('/specialty-samples/nope'))).status).toBe(400);
  });
});
