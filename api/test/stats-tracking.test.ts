import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';
import { StubTrackingProvider } from '../src/lib/tracking.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY);

describe('tracking stub', () => {
  const stub = new StubTrackingProvider();

  it('is deterministic for the same awb', () => {
    const d = new Date('2026-07-01T00:00:00Z');
    const now = new Date('2026-07-02T00:00:00Z');
    const a = stub.track('9620551651', d, now);
    const b = stub.track('9620551651', d, now);
    expect(a).toEqual(b);
  });

  it('delivers after the transit window', () => {
    const d = new Date('2026-06-01T00:00:00Z');
    const now = new Date('2026-07-01T00:00:00Z'); // 30 days later, max transit is 6
    const info = stub.track('1042774655', d, now);
    expect(info.status).toBe('delivered');
    expect(info.delivered_at).toBeTruthy();
  });

  it('is in transit right after dispatch with an eta', () => {
    const d = new Date('2026-07-01T00:00:00Z');
    const now = new Date('2026-07-01T12:00:00Z');
    const info = stub.track('4720858811', d, now);
    expect(info.status).toBe('in_transit');
    expect(info.eta).toBeTruthy();
  });
});

describe('endpoints', () => {
  it('GET /tracking/:awb works for unknown awb too', async () => {
    const res = await auth(request(app).get('/tracking/whatever123'));
    expect(res.status).toBe(200);
    expect(['in_transit', 'delivered']).toContain(res.body.status);
  });

  it('GET /stats returns tile payload', async () => {
    // /stats now aggregates over all_samples_v (specialty/bulk/forwarding), not legacy /samples.
    await auth(request(app).post('/specialty-samples')).send({ description: 'AA', receiver_company: 'X' });
    const b = await auth(request(app).post('/bulk-samples')).send({ quality: 'AAA', client: 'Y' });
    await auth(request(app).patch(`/bulk-samples/${b.body.id}`)).send({ status: 'dispatched', courier_norm: 'dhl', awb: 'ABC1' });
    const s2 = await auth(request(app).post('/specialty-samples')).send({ description: 'CC', receiver_company: 'Z' });
    await auth(request(app).patch(`/specialty-samples/${s2.body.id}`)).send({ status: 'delivered' });

    const res = await auth(request(app).get('/stats'));
    expect(res.body.by_status.requested).toBe(1);
    expect(res.body.in_transit).toBe(1);
    expect(res.body.awaiting_results).toBe(1); // delivered specialty sample with no result_norm yet
    expect(res.body.by_courier.dhl).toBe(1);
    expect(res.body.dispatched_this_week).toBe(1); // events-based: counts `dispatched` events fired this week, not rows created
    expect(res.body.overdue).toBeUndefined(); // legacy deadline-based scalar was removed by the /stats rewrite
  });
});
