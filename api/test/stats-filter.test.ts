import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('stats dashboard filters', () => {
  beforeAll(async () => {
    // specialty — sample_type defaults to 'other', country NULL
    await auth(request(app).post('/specialty-samples')).send({ description: 'AB', receiver_company: 'Beyers' });
    // bulk #1 — dispatched, quality contains "Grinder", Kenya, sample_type offer, known month
    const b1 = await auth(request(app).post('/bulk-samples')).send({
      quality: 'Grinder AA', client: 'Nestrade', country: 'Kenya', sample_type: 'offer',
    });
    await auth(request(app).patch(`/bulk-samples/${b1.body.id}`)).send({ status: 'dispatched', courier_norm: 'dhl', awb: 'X1' });
    // date_on is not set on create; set it directly so the month filter has something to bite on
    await pool.query(`UPDATE bulk_samples SET date_on = '2020-03-15' WHERE id = $1`, [b1.body.id]);
    // bulk #2 — requested, Brazil, sample_type type
    await auth(request(app).post('/bulk-samples')).send({
      quality: 'Espresso', client: 'X', country: 'Brazil', sample_type: 'type',
    });
    // forwarding — origin surfaces as country in the view
    await auth(request(app).post('/forwarding-samples')).send({
      sender: 'Kenyacof', origin: 'Uganda', sample_ref: 'S1', coffee_quality: 'AA', receiver_company: 'Beyers',
    });
  });

  it('filters by tab', async () => {
    const res = await auth(request(app).get('/stats?tab=bulk'));
    expect(res.status).toBe(200);
    expect(res.body.by_tab).toEqual({ bulk: 2 });
  });

  it('filters by status (and scopes the KPI scalars)', async () => {
    const res = await auth(request(app).get('/stats?status=dispatched'));
    expect(res.body.by_status).toEqual({ dispatched: 1 });
    expect(res.body.in_transit).toBe(1);
  });

  it('filters by sample_type (aggregate now runs off the view)', async () => {
    const res = await auth(request(app).get('/stats?sample_type=offer'));
    expect(res.body.by_sample_type).toEqual({ offer: 1 });
    expect(res.body.by_tab).toEqual({ bulk: 1 });
  });

  it('filters by country', async () => {
    const res = await auth(request(app).get('/stats?country=Kenya'));
    expect(res.body.by_country).toEqual({ Kenya: 1 });
  });

  it('filters by quality (case-insensitive contains on the view title)', async () => {
    const res = await auth(request(app).get('/stats?quality=grinder'));
    expect(res.body.by_tab).toEqual({ bulk: 1 });
  });

  it('filters by month, and option lists stay full-domain (never collapse)', async () => {
    const res = await auth(request(app).get('/stats?month=2020-03'));
    expect(res.body.volume_over_time).toEqual([{ month: '2020-03', n: 1 }]);
    expect(res.body.months).toContain('2020-03');
    expect(res.body.countries).toEqual(expect.arrayContaining(['Kenya', 'Brazil', 'Uganda']));
  });

  it('returns the option lists on an unfiltered request', async () => {
    const res = await auth(request(app).get('/stats'));
    expect(Array.isArray(res.body.months)).toBe(true);
    expect(Array.isArray(res.body.countries)).toBe(true);
    expect(res.body.countries).toEqual(expect.arrayContaining(['Kenya', 'Brazil', 'Uganda']));
  });

  it('ignores an unknown enum value instead of 500-ing', async () => {
    const res = await auth(request(app).get('/stats?status=notarealstatus'));
    expect(res.status).toBe(200);
    expect(res.body.by_status).toEqual({});
  });

  it('ANDs multiple filters together', async () => {
    const res = await auth(request(app).get('/stats?tab=bulk&country=Brazil'));
    expect(res.body.by_tab).toEqual({ bulk: 1 });
    expect(res.body.by_country).toEqual({ Brazil: 1 });
  });

  it('leaves dispatched_this_week global (unaffected by filters)', async () => {
    const unfiltered = await auth(request(app).get('/stats'));
    const filtered = await auth(request(app).get('/stats?tab=specialty'));
    expect(filtered.body.dispatched_this_week).toBe(unfiltered.body.dispatched_this_week);
  });
});
