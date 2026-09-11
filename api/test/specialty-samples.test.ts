import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, reapplyMigrationsFrom, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('specialty-samples', () => {
  let id: string;

  it('creates a specialty sample, issues a ref, writes a created event', async () => {
    const res = await auth(request(app).post('/specialty-samples')).send({
      description: 'AB FAQ washed', receiver_company: 'Beyers', sample_type_norm: 'offer', grade: 'AB', bags: 10,
    });
    expect(res.status).toBe(201);
    expect(res.body.ref).toBe('SL-7459');
    expect(res.body.status).toBe('requested');
    id = res.body.id;
    const detail = await auth(request(app).get(`/specialty-samples/${id}`));
    expect(detail.body.events).toHaveLength(1);
    expect(detail.body.events[0]).toMatchObject({ type: 'created', actor: 'test', entity_type: 'specialty' });
  });

  it('rejects a create missing required fields (422/400)', async () => {
    const res = await auth(request(app).post('/specialty-samples')).send({ grade: 'AB' });
    expect(res.status).toBe(400);
  });

  it('lists with a status filter and true total', async () => {
    const res = await auth(request(app).get('/specialty-samples?status=requested'));
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].description).toBe('AB FAQ washed');
  });

  it('sorts by a whitelisted column; ignores an unknown sort', async () => {
    const ok = await auth(request(app).get('/specialty-samples?sort=date_on&order=asc'));
    expect(ok.status).toBe(200);
    const bad = await auth(request(app).get('/specialty-samples?sort=evil'));
    expect(bad.status).toBe(200); // falls back, no error
  });

  it('dispatch via PATCH writes a dispatched event + timestamps status', async () => {
    const res = await auth(request(app).patch(`/specialty-samples/${id}`)).send({
      status: 'dispatched', courier_norm: 'dhl', awb: '9620551651',
    });
    expect(res.body.status).toBe('dispatched');
    const d = await auth(request(app).get(`/specialty-samples/${id}`));
    expect(d.body.events.map((e: { type: string }) => e.type)).toContain('dispatched');
  });

  it('dispatched_on is editable after the fact and rejects a bad format (feedback #35)', async () => {
    // The dispatch in the previous test auto-stamped today; an explicit edit overrides it.
    const res = await auth(request(app).patch(`/specialty-samples/${id}`)).send({ dispatched_on: '2026-08-20' });
    expect(res.status).toBe(200);
    expect(String(res.body.dispatched_on)).toContain('2026-08-20');
    // A fresh, never-dispatched row accepts a direct date too (status untouched).
    const fresh = await auth(request(app).post('/specialty-samples')).send({
      description: 'date-edit', receiver_company: 'Beyers', sample_type_norm: 'offer',
    });
    const set = await auth(request(app).patch(`/specialty-samples/${fresh.body.id}`)).send({ dispatched_on: '2026-08-19' });
    expect(String(set.body.dispatched_on)).toContain('2026-08-19');
    expect(set.body.status).toBe('requested');
    // Garbage is rejected before it reaches the ::date cast.
    expect((await auth(request(app).patch(`/specialty-samples/${id}`)).send({ dispatched_on: '20/08/2026' })).status).toBe(400);
  });

  it('result via PATCH derives results_in and logs result_logged', async () => {
    const res = await auth(request(app).patch(`/specialty-samples/${id}`)).send({ result_norm: 'approved' });
    expect(res.body.status).toBe('results_in');
    expect(res.body.result_norm).toBe('approved');
  });

  it('soft-deletes: DELETE hides the row from lists and logs a deleted event', async () => {
    const del = await auth(request(app).delete(`/specialty-samples/${id}`));
    expect(del.status).toBe(200);
    const list = await auth(request(app).get('/specialty-samples'));
    expect(list.body.data.find((r: { id: string }) => r.id === id)).toBeUndefined();
    const d = await auth(request(app).get(`/specialty-samples/${id}`));
    expect(d.body.events.map((e: { type: string }) => e.type)).toContain('deleted');
  });

  it('PATCH on a soft-deleted row 404s and writes no new event (closes the SELECT→UPDATE race window)', async () => {
    const created = await auth(request(app).post('/specialty-samples')).send({
      description: 'Race guard fixture', receiver_company: 'Beyers',
    });
    const rid = created.body.id;
    const del = await auth(request(app).delete(`/specialty-samples/${rid}`));
    expect(del.status).toBe(200);

    const before = await auth(request(app).get(`/specialty-samples/${rid}`));
    expect(before.body.events.map((e: { type: string }) => e.type)).toEqual(['created', 'deleted']);

    const patch = await auth(request(app).patch(`/specialty-samples/${rid}`)).send({ status: 'dispatched' });
    expect(patch.status).toBe(404);

    const after = await auth(request(app).get(`/specialty-samples/${rid}`));
    expect(after.body.events).toHaveLength(before.body.events.length); // the failed PATCH added nothing
  });

  it('404s on unknown id, 400 on bad id', async () => {
    expect((await auth(request(app).get('/specialty-samples/00000000-0000-0000-0000-000000000000'))).status).toBe(404);
    expect((await auth(request(app).get('/specialty-samples/nope'))).status).toBe(400);
  });

  it('400s on an invalid status filter value instead of a 500 enum-cast error', async () => {
    const res = await auth(request(app).get('/specialty-samples?status=bogus'));
    expect(res.status).toBe(400);
  });

  it('falls back to the default page/pageSize on non-numeric pagination params (no 500)', async () => {
    const res = await auth(request(app).get('/specialty-samples?page=abc&pageSize=abc'));
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(25);
  });

  it('empty PATCH {} is a no-op: 200, unchanged row, no new event', async () => {
    const created = await auth(request(app).post('/specialty-samples')).send({
      description: 'No-op fixture', receiver_company: 'Beyers',
    });
    const rid = created.body.id;
    const before = await auth(request(app).get(`/specialty-samples/${rid}`));
    const res = await auth(request(app).patch(`/specialty-samples/${rid}`)).send({});
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(rid);
    const after = await auth(request(app).get(`/specialty-samples/${rid}`));
    expect(after.body.events).toHaveLength(before.body.events.length);
  });

  it('defaults date + date_on to Nairobi today when none is given', async () => {
    const res = await auth(request(app).post('/specialty-samples')).send({
      description: 'Date default fixture', receiver_company: 'Beyers',
    });
    expect(res.status).toBe(201);
    const nairobiToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
    const { rows } = await pool.query(
      `SELECT date::text AS d, date_on::text AS don FROM specialty_samples WHERE id = $1`, [res.body.id],
    );
    expect(rows[0].d).toBe(nairobiToday);
    expect(rows[0].don).toBe(nairobiToday);
    expect(res.body.date).toBe(nairobiToday);
  });

  it('honors an explicit ISO date override', async () => {
    const res = await auth(request(app).post('/specialty-samples')).send({
      description: 'Date override fixture', receiver_company: 'Beyers', date: '2020-01-15',
    });
    expect(res.status).toBe(201);
    const { rows } = await pool.query(
      `SELECT date::text AS d, date_on::text AS don FROM specialty_samples WHERE id = $1`, [res.body.id],
    );
    expect(rows[0].d).toBe('2020-01-15');
    expect(rows[0].don).toBe('2020-01-15');
  });

  it('breaks list ties by created_at DESC (newest-created first), not by id', async () => {
    // Two rows sharing a date_on; give the OLDER one the LOWER id so an id-ASC tiebreak would
    // (wrongly) place it first. created_at DESC must put the newer row first regardless of id.
    const older = '11111111-1111-1111-1111-111111111111';
    const newer = '99999999-9999-9999-9999-999999999999';
    await pool.query(
      `INSERT INTO specialty_samples (id, description, receiver_company, status, date_on, created_at)
       VALUES ($1,'Tiebreak older','Beyers','requested', CURRENT_DATE, now() - interval '1 hour'),
              ($2,'Tiebreak newer','Beyers','requested', CURRENT_DATE, now())`,
      [older, newer],
    );
    const list = await auth(request(app).get('/specialty-samples?pageSize=100'));
    const ids = list.body.data.map((r: { id: string }) => r.id);
    expect(ids.indexOf(newer)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(newer)).toBeLessThan(ids.indexOf(older)); // newer created_at wins the tie
  });

  it('roundtrips phyto_cert on create and patch', async () => {
    const created = await auth(request(app).post('/specialty-samples')).send({
      description: 'Phyto fixture', receiver_company: 'Beyers', phyto_cert: 'Yes',
    });
    expect(created.status).toBe(201);
    expect(created.body.phyto_cert).toBe('Yes');
    const patched = await auth(request(app).patch(`/specialty-samples/${created.body.id}`)).send({ phyto_cert: 'No' });
    expect(patched.body.phyto_cert).toBe('No');
  });

  it('migration 022 (stocklot) is re-runnable', async () => {
    expect(await reapplyMigrationsFrom('022')).toContain('022_label_slip_fields.sql');
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'specialty_samples' AND column_name = 'stocklot'`);
    expect(rows).toHaveLength(1);
  });

  // Gloria's slips (2026-09-11): Stocklot · Outturn · Grower · Screen · Crop. The lot fields must be
  // settable on create AND fixable afterwards, or a label can only ever print what intake typed.
  it('slip fields: stocklot on create; stocklot, outturn, grower name and crop year editable; ?q= finds a lot', async () => {
    const created = await auth(request(app).post('/specialty-samples')).send({
      description: 'Slip fixture', receiver_company: 'Beyers', outturn: '08KN0021', name: 'KII/KIRINYAGA',
      grade: 'AB', crop_year: '2025/2026', stocklot: 'DS',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ stocklot: 'DS', outturn: '08KN0021', name: 'KII/KIRINYAGA', crop_year: '2025/2026' });

    const patched = await auth(request(app).patch(`/specialty-samples/${created.body.id}`)).send({
      stocklot: '15/5670', outturn: '13KP0215', name: 'CHERIWET', crop_year: '2026/2027',
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ stocklot: '15/5670', outturn: '13KP0215', name: 'CHERIWET', crop_year: '2026/2027' });

    for (const q of ['13KP0215', '15/5670']) {
      const found = await auth(request(app).get('/specialty-samples').query({ q }));
      expect(found.body.data.map((r: { id: string }) => r.id)).toEqual([created.body.id]);
    }
  });
});
