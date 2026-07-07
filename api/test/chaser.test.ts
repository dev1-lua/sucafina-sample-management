import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';
import { pool } from '../src/db.js';

beforeAll(async () => {
  await resetDb();
  const auth = (r: request.Test) => r.set('x-api-key', API_KEY);
  // overdue undispatched offer
  await auth(request(app).post('/samples')).send({ sample_type: 'offer', quality: 'AB FAQ', receiver: 'Edmax', deadline: '2026-01-01' });
  // overdue undispatched PSS (must sort before the offer)
  await auth(request(app).post('/samples')).send({ sample_type: 'pss', quality: 'AAA Nespresso', receiver: 'Nestrade', deadline: '2026-06-01' });
  // stale dispatched
  const d = await auth(request(app).post('/samples')).send({ sample_type: 'type', quality: 'ABC FAQ', receiver: 'Beyers' });
  await auth(request(app).patch(`/samples/${d.body.id}`)).send({ status: 'dispatched', courier: 'dhl', awb: 'OLD1' });
  await pool.query(`UPDATE samples SET dispatched_at = now() - interval '10 days' WHERE id = $1`, [d.body.id]);
  // delivered awaiting results
  const r = await auth(request(app).post('/samples')).send({ sample_type: 'offer', quality: 'PB', receiver: 'Key Coffee' });
  await auth(request(app).patch(`/samples/${r.body.id}`)).send({ status: 'delivered' });
  await pool.query(`UPDATE samples SET delivered_at = now() - interval '10 days' WHERE id = $1`, [r.body.id]);
});

const auth = (r: request.Test) => r.set('x-api-key', API_KEY);

describe('chaser', () => {
  it('404s before any digest exists', async () => {
    const res = await auth(request(app).get('/chaser/digest'));
    expect(res.status).toBe(404);
  });

  it('computes buckets with PSS first', async () => {
    const res = await auth(request(app).post('/chaser/run'));
    expect(res.status).toBe(200);
    const b = res.body.buckets;
    expect(b.not_dispatched.count).toBe(2);
    expect(b.not_dispatched.items[0].sample_type).toBe('pss');
    expect(b.no_delivery_confirmation.count).toBe(1);
    expect(b.awaiting_results.count).toBe(1);
  });

  it('persists the digest and writes chased events', async () => {
    const res = await auth(request(app).get('/chaser/digest'));
    expect(res.status).toBe(200);
    expect(res.body.buckets.not_dispatched.count).toBe(2);
    const ev = await pool.query(`SELECT count(*)::int AS n FROM sample_events WHERE type = 'chased'`);
    expect(ev.rows[0].n).toBe(4);
  });
});
