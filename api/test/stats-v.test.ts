import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('stats over all_samples_v', () => {
  beforeAll(async () => {
    await auth(request(app).post('/specialty-samples')).send({ description: 'AB', receiver_company: 'Beyers' });
    const b = await auth(request(app).post('/bulk-samples')).send({ quality: 'AA', client: 'Nestrade', country: 'Kenya' });
    await auth(request(app).patch(`/bulk-samples/${b.body.id}`)).send({ status: 'dispatched', courier_norm: 'dhl', awb: 'X1' });
    await auth(request(app).post('/forwarding-samples')).send({
      sender: 'Kenyacof', origin: 'Uganda', sample_ref: 'S1', coffee_quality: 'AA', receiver_company: 'Beyers',
    });
  });

  it('returns cross-tab aggregates', async () => {
    const res = await auth(request(app).get('/stats'));
    expect(res.status).toBe(200);
    expect(res.body.by_tab).toMatchObject({ specialty: 1, bulk: 1, forwarding: 1 });
    expect(res.body.by_status.requested).toBeGreaterThanOrEqual(2);
    expect(res.body.by_status.dispatched).toBe(1);
    expect(res.body.in_transit).toBe(1);
    expect(res.body.by_country).toMatchObject({ Kenya: 1 });
    expect(res.body.by_sample_type.other).toBe(2); // specialty + bulk both default to 'other'; forwarding has none
    expect(Array.isArray(res.body.volume_over_time)).toBe(true);
  });
});
