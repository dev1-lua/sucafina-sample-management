import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';
import { pool } from '../src/db.js';

const auth = (r: request.Test) => r.set('x-api-key', API_KEY);

beforeAll(async () => {
  await resetDb();
  // overdue undispatched specialty sample, backdated so it sorts first (oldest date_on)
  const a = await auth(request(app).post('/specialty-samples')).send({ description: 'AB FAQ', receiver_company: 'Edmax' });
  await pool.query(`UPDATE specialty_samples SET date_on = CURRENT_DATE - 20 WHERE id = $1`, [a.body.id]);
  // overdue undispatched bulk sample (no date_on at all — still overdue per the digest's NULL-date rule)
  await auth(request(app).post('/bulk-samples')).send({ quality: 'AAA Nespresso', client: 'Nestrade' });
  // stale dispatched bulk sample
  const d = await auth(request(app).post('/bulk-samples')).send({ quality: 'ABC FAQ', client: 'Beyers' });
  await auth(request(app).patch(`/bulk-samples/${d.body.id}`)).send({ status: 'dispatched', courier_norm: 'dhl', awb: 'OLD1' });
  await pool.query(`UPDATE bulk_samples SET date_on = CURRENT_DATE - 10 WHERE id = $1`, [d.body.id]);
  // delivered specialty sample awaiting results
  const r = await auth(request(app).post('/specialty-samples')).send({ description: 'PB', receiver_company: 'Key Coffee' });
  await auth(request(app).patch(`/specialty-samples/${r.body.id}`)).send({ status: 'delivered' });
  await pool.query(`UPDATE specialty_samples SET delivery_on = CURRENT_DATE - 10 WHERE id = $1`, [r.body.id]);
});

describe('chaser', () => {
  it('404s before any digest exists', async () => {
    const res = await auth(request(app).get('/chaser/digest'));
    expect(res.status).toBe(404);
  });

  it('computes buckets ordered oldest-date_on-first (NULLs last) across entity types', async () => {
    const res = await auth(request(app).post('/chaser/run'));
    expect(res.status).toBe(200);
    const b = res.body.buckets;
    expect(b.not_dispatched.count).toBe(2);
    // date_on ASC NULLS LAST: the backdated specialty row sorts before the null-date_on bulk row
    expect(b.not_dispatched.items[0].tab).toBe('specialty');
    expect(b.not_dispatched.items[1].tab).toBe('bulk');
    expect(b.no_delivery_confirmation.count).toBe(1);
    expect(b.awaiting_results.count).toBe(1);
  });

  it('persists the digest and writes chased events on the polymorphic events table', async () => {
    const res = await auth(request(app).get('/chaser/digest'));
    expect(res.status).toBe(200);
    expect(res.body.buckets.not_dispatched.count).toBe(2);
    const ev = await pool.query(`SELECT count(*)::int AS n FROM events WHERE type = 'chased'`);
    expect(ev.rows[0].n).toBe(4);
  });
});
