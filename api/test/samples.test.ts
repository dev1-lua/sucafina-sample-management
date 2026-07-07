import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('samples', () => {
  let id: string;

  it('creates a sample and issues an SL ref', async () => {
    const res = await auth(request(app).post('/samples')).send({
      sample_type: 'offer',
      quality: 'AB FAQ',
      receiver: 'Beyers',
      requester: 'Omar',
      qty_grams: 500,
      deadline: '2026-07-10',
    });
    expect(res.status).toBe(201);
    expect(res.body.ref).toBe('SL-8000');
    expect(res.body.status).toBe('requested');
    id = res.body.id;
  });

  it('issues TYPE refs for type samples and SSKE for pss', async () => {
    const t = await auth(request(app).post('/samples')).send({ sample_type: 'type', quality: 'ABC FAQ', receiver: 'Beyers' });
    expect(t.body.ref).toBe('TYPE-1000');
    const p = await auth(request(app).post('/samples')).send({ sample_type: 'pss', quality: 'AA SANGALAI', receiver: 'Sucafina Yunnan' });
    expect(p.body.ref).toBe('SSKE-108000');
  });

  it('records a requested event with actor', async () => {
    const res = await auth(request(app).get(`/samples/${id}/events`));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ type: 'requested', actor: 'test' });
  });

  it('filters by status and q', async () => {
    const res = await auth(request(app).get('/samples?status=requested&q=beyers'));
    expect(res.body.total).toBe(2);
  });

  it('dispatch via PATCH writes dispatched event and timestamps', async () => {
    const res = await auth(request(app).patch(`/samples/${id}`)).send({
      status: 'dispatched', courier: 'dhl', awb: '9620551651',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('dispatched');
    expect(res.body.dispatched_at).toBeTruthy();
    const ev = await auth(request(app).get(`/samples/${id}/events`));
    expect(ev.body.data.map((e: { type: string }) => e.type)).toContain('dispatched');
  });

  it('result via PATCH writes result_logged and results_in status', async () => {
    await auth(request(app).patch(`/samples/${id}`)).send({ status: 'delivered' });
    const res = await auth(request(app).patch(`/samples/${id}`)).send({
      result: 'approved', cupping_notes: '83p, citrus driven, clean',
    });
    expect(res.body.status).toBe('results_in');
    expect(res.body.result).toBe('approved');
  });

  it('overdue filter finds past-deadline undispatched samples', async () => {
    await auth(request(app).post('/samples')).send({
      sample_type: 'offer', quality: 'PB', receiver: 'Key Coffee', deadline: '2026-01-01',
    });
    const res = await auth(request(app).get('/samples?overdue=true'));
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].receiver).toBe('Key Coffee');
  });

  it('awaiting_results filter finds delivered samples without result', async () => {
    const s = await auth(request(app).post('/samples')).send({ sample_type: 'pss', quality: 'AAA', receiver: 'Nestrade' });
    await auth(request(app).patch(`/samples/${s.body.id}`)).send({ status: 'delivered' });
    const res = await auth(request(app).get('/samples?awaiting_results=true'));
    expect(res.body.total).toBe(1);
  });

  it('404s on unknown sample', async () => {
    const res = await auth(request(app).get('/samples/00000000-0000-0000-0000-000000000000'));
    expect(res.status).toBe(404);
  });
});
