import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('bulk-samples', () => {
  let id: string;

  it('creates a bulk sample and writes a created event', async () => {
    const res = await auth(request(app).post('/bulk-samples')).send({
      quality: 'AA washed', client: 'Nestrade', sample_type: 'offer', country: 'Kenya',
      moisture_pct: 10.5, water_activity_num: 0.43, sample_ref: 'SSUG-97044',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('requested');
    expect(Number(res.body.moisture_pct)).toBe(10.5);
    id = res.body.id;
    const d = await auth(request(app).get(`/bulk-samples/${id}`));
    expect(d.body.events[0]).toMatchObject({ type: 'created', entity_type: 'bulk' });
  });

  it('rejects a create missing required fields', async () => {
    expect((await auth(request(app).post('/bulk-samples')).send({ country: 'Kenya' })).status).toBe(400);
  });

  it('filters by moisture_pct range', async () => {
    await auth(request(app).post('/bulk-samples')).send({ quality: 'PB', client: 'X', sample_type: 'type', moisture_pct: 8 });
    const res = await auth(request(app).get('/bulk-samples?moisture_min=10'));
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].client).toBe('Nestrade');
  });

  it('filters by country', async () => {
    const res = await auth(request(app).get('/bulk-samples?country=Kenya'));
    expect(res.body.total).toBe(1);
  });

  it('result via PATCH derives results_in', async () => {
    const res = await auth(request(app).patch(`/bulk-samples/${id}`)).send({ result_norm: 'rejected' });
    expect(res.body.status).toBe('results_in');
  });

  it('soft-deletes', async () => {
    await auth(request(app).delete(`/bulk-samples/${id}`));
    const d = await auth(request(app).get(`/bulk-samples/${id}`));
    expect(d.body.events.map((e: { type: string }) => e.type)).toContain('deleted');
  });

  it('defaults date + date_on to Nairobi today when none is given', async () => {
    const res = await auth(request(app).post('/bulk-samples')).send({ quality: 'Date fixture', client: 'X' });
    expect(res.status).toBe(201);
    const nairobiToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
    const { rows } = await pool.query(`SELECT date::text AS d, date_on::text AS don FROM bulk_samples WHERE id = $1`, [res.body.id]);
    expect(rows[0].d).toBe(nairobiToday);
    expect(rows[0].don).toBe(nairobiToday);
    expect(res.body.date).toBe(nairobiToday);
  });

  it('auto-issues a Commercial ref when none is supplied (feedback ⑱)', async () => {
    // Prefix mapping mirrors issueRef: pss→SSKE, type→TYPE, everything else (incl. offer)→SL.
    const pss = await auth(request(app).post('/bulk-samples')).send({ quality: 'AB', client: 'Paulig', sample_type: 'pss' });
    expect(pss.status).toBe(201);
    expect(pss.body.sample_ref).toMatch(/^SSKE-\d+$/);
    const type = await auth(request(app).post('/bulk-samples')).send({ quality: 'AA', client: 'Paulig', sample_type: 'type' });
    expect(type.body.sample_ref).toMatch(/^TYPE-\d+$/);
    const offer = await auth(request(app).post('/bulk-samples')).send({ quality: 'C', client: 'Paulig', sample_type: 'offer' });
    expect(offer.body.sample_ref).toMatch(/^SL-\d+$/);
    // An explicitly supplied ref is preserved untouched.
    const explicit = await auth(request(app).post('/bulk-samples')).send({ quality: 'PB', client: 'Paulig', sample_type: 'offer', sample_ref: 'CUSTOM-1' });
    expect(explicit.body.sample_ref).toBe('CUSTOM-1');
  });

  it('roundtrips blend / rejection_reason / shipment_month / contract_number / location (migration 007)', async () => {
    const created = await auth(request(app).post('/bulk-samples')).send({
      quality: 'AA PLUS (30%), AB (70%)', client: 'Paulig', sample_type: 'pss',
      blend: 'AA PLUS 30% / AB 70%', shipment_month: 'June', contract_number: 'CT-2026-14', location: 'westlands',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      blend: 'AA PLUS 30% / AB 70%', shipment_month: 'June', contract_number: 'CT-2026-14', location: 'westlands',
    });
    const patched = await auth(request(app).patch(`/bulk-samples/${created.body.id}`)).send({
      result_norm: 'rejected', rejection_reason: 'moldy, inconsistent cup',
    });
    expect(patched.body.result_norm).toBe('rejected');
    expect(patched.body.rejection_reason).toBe('moldy, inconsistent cup');
    // Location filter (case-insensitive) finds it.
    const listed = await auth(request(app).get('/bulk-samples?location=Westlands'));
    expect(listed.body.data.some((r: { id: string }) => r.id === created.body.id)).toBe(true);
  });

  it('roundtrips phyto_cert on create and patch', async () => {
    const created = await auth(request(app).post('/bulk-samples')).send({
      quality: 'Phyto fixture', client: 'X', phyto_cert: 'Yes',
    });
    expect(created.status).toBe(201);
    expect(created.body.phyto_cert).toBe('Yes');
    const patched = await auth(request(app).patch(`/bulk-samples/${created.body.id}`)).send({ phyto_cert: 'Client to confirm' });
    expect(patched.body.phyto_cert).toBe('Client to confirm');
  });
});
