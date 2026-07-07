import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('search', () => {
  beforeAll(async () => {
    await auth(request(app).post('/specialty-samples')).send({ ref: 'SL-1', description: 'Kirinyaga AB', receiver_company: 'Beyers', awb: 'AWB123' });
    await auth(request(app).post('/bulk-samples')).send({ sample_ref: 'SSUG-9', quality: 'Bugisu AA', client: 'Beyers' });
  });

  it('returns hits across tabs with tab+id for write-routing', async () => {
    const res = await auth(request(app).get('/search?q=Beyers'));
    expect(res.body.total).toBe(2);
    for (const hit of res.body.data) {
      expect(hit).toHaveProperty('tab');
      expect(hit).toHaveProperty('id');
      expect(['specialty', 'bulk', 'forwarding']).toContain(hit.tab);
    }
  });

  it('filters by tab', async () => {
    const res = await auth(request(app).get('/search?q=Beyers&tab=bulk'));
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].tab).toBe('bulk');
  });

  it('finds by awb', async () => {
    const res = await auth(request(app).get('/search?awb=AWB123'));
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].tab).toBe('specialty');
  });
});
