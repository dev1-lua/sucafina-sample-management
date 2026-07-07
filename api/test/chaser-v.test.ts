import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';
import { pool } from '../src/db.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('chaser over all_samples_v', () => {
  it('runs a digest and writes chased events on the correct entity_type', async () => {
    // a specialty sample delivered long ago with no result → awaiting_results bucket
    const s = await auth(request(app).post('/specialty-samples')).send({ description: 'Old AB', receiver_company: 'Beyers' });
    await pool.query(`UPDATE specialty_samples SET status='delivered', delivery_on = CURRENT_DATE - 30 WHERE id=$1`, [s.body.id]);

    const run = await auth(request(app).post('/chaser/run'));
    expect(run.status).toBe(200);
    expect(run.body.buckets).toHaveProperty('awaiting_results');

    const ev = await pool.query(`SELECT * FROM events WHERE entity_id = $1 AND type = 'chased'`, [s.body.id]);
    expect(ev.rows.length).toBeGreaterThanOrEqual(1);
    expect(ev.rows[0].entity_type).toBe('specialty');
  });

  it('excludes forwarding from awaiting_results', async () => {
    const fwd = await auth(request(app).post('/forwarding-samples')).send({
      sender: 'Kenyacof', origin: 'Uganda', sample_ref: 'S2', coffee_quality: 'AA', receiver_company: 'Beyers',
    });
    await pool.query(`UPDATE forwarding_samples SET status='delivered' WHERE id=$1`, [fwd.body.id]);
    const digest = await auth(request(app).get('/chaser/digest'));
    const ids = digest.body.buckets.awaiting_results.items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(fwd.body.id);
  });

  it('GET /tracking/:awb reads from the view', async () => {
    const s = await auth(request(app).post('/bulk-samples')).send({ quality: 'AA', client: 'X' });
    await auth(request(app).patch(`/bulk-samples/${s.body.id}`)).send({ status: 'dispatched', courier_norm: 'dhl', awb: 'TRK999' });
    const res = await auth(request(app).get('/tracking/TRK999'));
    expect(res.status).toBe(200);
    expect(['in_transit', 'delivered']).toContain(res.body.status);
  });
});
