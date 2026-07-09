import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

// Multi-select enum filters + case-insensitive / canonicalized Country. Country is stored verbatim;
// matching lowercases both sides and the facet/aggregate canonicalize to Title Case (initcap).
describe('multi-select filters + country normalization', () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    // #1 Kenya · offer · dispatched (dhl)
    const b1 = await auth(request(app).post('/bulk-samples')).send({ quality: 'AA', client: 'C1', country: 'Kenya', sample_type: 'offer' });
    await auth(request(app).patch(`/bulk-samples/${b1.body.id}`)).send({ status: 'dispatched', courier_norm: 'dhl', awb: 'X1' });
    await pool.query(`UPDATE bulk_samples SET date_on = '2020-03-15' WHERE id = $1`, [b1.body.id]);
    ids.b1 = b1.body.id;
    // #2 KENYA (upper-case variant) · type · results_in (rejected, fedex)
    const b2 = await auth(request(app).post('/bulk-samples')).send({ quality: 'BB', client: 'C2', country: 'KENYA', sample_type: 'type' });
    await auth(request(app).patch(`/bulk-samples/${b2.body.id}`)).send({ result_norm: 'rejected', courier_norm: 'fedex' });
    await pool.query(`UPDATE bulk_samples SET date_on = '2020-04-10' WHERE id = $1`, [b2.body.id]);
    ids.b2 = b2.body.id;
    // #3 Brazil · pss · requested
    const b3 = await auth(request(app).post('/bulk-samples')).send({ quality: 'CC', client: 'C3', country: 'Brazil', sample_type: 'pss' });
    await pool.query(`UPDATE bulk_samples SET date_on = '2020-04-20' WHERE id = $1`, [b3.body.id]);
    ids.b3 = b3.body.id;
    // #4 quality WITH a comma (no country/courier/result) — exercises comma-safe quality matching.
    const b4 = await auth(request(app).post('/bulk-samples')).send({ quality: 'Blend, A', client: 'C4', sample_type: 'woc' });
    ids.b4 = b4.body.id;
  });

  // ---- Dashboard /stats ----
  it('dedupes case-variant countries in the facet list and by_country aggregate', async () => {
    const res = await auth(request(app).get('/stats'));
    // 'Kenya' + 'KENYA' collapse to one canonical 'Kenya'; the raw upper-case variant never appears.
    expect(res.body.countries).toEqual(expect.arrayContaining(['Kenya', 'Brazil']));
    expect(res.body.countries).not.toContain('KENYA');
    expect(res.body.by_country).toEqual({ Kenya: 2, Brazil: 1 });
  });

  it('matches country case-insensitively', async () => {
    const res = await auth(request(app).get('/stats?country=kenya'));
    expect(res.body.by_country).toEqual({ Kenya: 2 });
  });

  it('accepts a multi-value country filter', async () => {
    const res = await auth(request(app).get('/stats?country=Kenya,Brazil'));
    expect(res.body.by_country).toEqual({ Kenya: 2, Brazil: 1 });
  });

  it('accepts a multi-value sample_type filter', async () => {
    const res = await auth(request(app).get('/stats?sample_type=offer,pss'));
    expect(res.body.by_sample_type).toEqual({ offer: 1, pss: 1 });
  });

  it('accepts a multi-value month filter', async () => {
    const res = await auth(request(app).get('/stats?month=2020-03,2020-04'));
    expect(res.body.volume_over_time).toEqual([
      { month: '2020-03', n: 1 },
      { month: '2020-04', n: 2 },
    ]);
  });

  it('returns the full distinct quality option list', async () => {
    const res = await auth(request(app).get('/stats'));
    expect(res.body.qualities).toEqual(expect.arrayContaining(['AA', 'BB', 'CC']));
  });

  it('filters by a picked quality value (exact)', async () => {
    const res = await auth(request(app).get('/stats?quality=CC'));
    expect(res.body.by_tab).toEqual({ bulk: 1 });
  });

  it('accepts a multi-value quality filter (repeated params, exact)', async () => {
    const res = await auth(request(app).get('/stats?quality=AA&quality=BB'));
    expect(res.body.by_tab).toEqual({ bulk: 2 });
  });

  it('is comma-safe for quality values that contain commas', async () => {
    // Single repeated param whose value has a comma; must match the one row, not split into fragments.
    const res = await auth(request(app).get('/stats?quality=Blend%2C%20A'));
    expect(res.body.by_tab).toEqual({ bulk: 1 });
  });

  // ---- List route (bulk) ----
  it('list: multi-value sample_type_norm', async () => {
    const res = await auth(request(app).get('/bulk-samples?sample_type_norm=offer,type'));
    expect(res.body.total).toBe(2);
  });

  it('list: multi-value courier_norm', async () => {
    const res = await auth(request(app).get('/bulk-samples?courier_norm=dhl,fedex'));
    expect(res.body.total).toBe(2);
  });

  it('list: multi-value result_norm', async () => {
    const res = await auth(request(app).get('/bulk-samples?result_norm=approved,rejected'));
    expect(res.body.total).toBe(1);
  });

  it('list: country is case-insensitive + multi', async () => {
    const lower = await auth(request(app).get('/bulk-samples?country=kenya'));
    expect(lower.body.total).toBe(2);
    const multi = await auth(request(app).get('/bulk-samples?country=Kenya,Brazil'));
    expect(multi.body.total).toBe(3);
  });

  it('list: 400s when any value in a multi enum is invalid', async () => {
    expect((await auth(request(app).get('/bulk-samples?sample_type_norm=offer,bogus'))).status).toBe(400);
    expect((await auth(request(app).get('/bulk-samples?courier_norm=dhl,bogus'))).status).toBe(400);
    expect((await auth(request(app).get('/bulk-samples?result_norm=approved,bogus'))).status).toBe(400);
  });

  // ---- Search ----
  it('search: country is case-insensitive', async () => {
    const res = await auth(request(app).get('/search?country=kenya'));
    expect(res.body.total).toBe(2);
  });
});
