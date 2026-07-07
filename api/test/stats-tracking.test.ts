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
    await auth(request(app).post('/samples')).send({ sample_type: 'offer', quality: 'AA', receiver: 'X', deadline: '2026-01-01' });
    const s = await auth(request(app).post('/samples')).send({ sample_type: 'pss', quality: 'AAA', receiver: 'Y' });
    await auth(request(app).patch(`/samples/${s.body.id}`)).send({ status: 'dispatched', courier: 'dhl', awb: 'ABC1' });
    const res = await auth(request(app).get('/stats'));
    expect(res.body.by_status.requested).toBe(1);
    expect(res.body.in_transit).toBe(1);
    expect(res.body.overdue).toBe(1);
    expect(res.body.dispatched_this_week).toBe(1);
  });
});
