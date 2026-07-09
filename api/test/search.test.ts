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

  it('400s on an invalid status filter value instead of a 500 enum-cast error', async () => {
    const res = await auth(request(app).get('/search?status=bogus'));
    expect(res.status).toBe(400);
  });

  it('falls back to the default pageSize on a non-numeric pageSize (no 500)', async () => {
    const res = await auth(request(app).get('/search?pageSize=abc'));
    expect(res.status).toBe(200);
  });
});

describe('search pagination', () => {
  // A unique receiver so these rows are isolated from the rest of the seeded data.
  beforeAll(async () => {
    for (const n of [1, 2, 3]) {
      await auth(request(app).post('/specialty-samples')).send({ ref: `ZP-${n}`, description: `lot ${n}`, receiver_company: 'ZPagerCo' });
    }
  });

  it('pages through results with page/pageSize and echoes them, total stays the true count', async () => {
    const p1 = await auth(request(app).get('/search?q=ZPagerCo&pageSize=1&page=1'));
    expect(p1.body.total).toBe(3);
    expect(p1.body.page).toBe(1);
    expect(p1.body.pageSize).toBe(1);
    expect(p1.body.data).toHaveLength(1);

    const p2 = await auth(request(app).get('/search?q=ZPagerCo&pageSize=1&page=2'));
    expect(p2.body.total).toBe(3);
    expect(p2.body.page).toBe(2);
    expect(p2.body.data).toHaveLength(1);
    // Different page → different row (the offset advanced), so the caller can walk all 3.
    expect(p2.body.data[0].id).not.toBe(p1.body.data[0].id);
  });

  it('returns an empty page past the end without erroring', async () => {
    const res = await auth(request(app).get('/search?q=ZPagerCo&pageSize=1&page=99'));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('search widened fields + filters', () => {
  beforeAll(async () => {
    await auth(request(app).post('/bulk-samples')).send({
      sample_ref: 'ZQ-1', quality: 'ZQWIDE lot', client: 'ZQWideCo', country: 'Testland', sample_type: 'pss',
    });
  });

  it('exposes country, sample_type_norm and qty_grams in results', async () => {
    const res = await auth(request(app).get('/search?q=ZQWIDE'));
    expect(res.body.total).toBe(1);
    const hit = res.body.data[0];
    expect(hit).toHaveProperty('country', 'Testland');
    expect(hit).toHaveProperty('sample_type_norm', 'pss');
    expect(hit).toHaveProperty('qty_grams'); // present (PSS default may fill it)
  });

  it('filters by country', async () => {
    const res = await auth(request(app).get('/search?country=Testland'));
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].country).toBe('Testland');
  });

  it('filters by sample_type', async () => {
    const res = await auth(request(app).get('/search?q=ZQWIDE&sample_type=pss'));
    expect(res.body.total).toBe(1);
    const none = await auth(request(app).get('/search?q=ZQWIDE&sample_type=offer'));
    expect(none.body.total).toBe(0);
  });
});
