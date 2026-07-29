import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('migration 010 idempotency', () => {
  it('re-applies cleanly against an already-migrated schema', async () => {
    const sql = readFileSync(fileURLToPath(new URL('../migrations/010_requested_stock_notify.sql', import.meta.url)), 'utf8');
    await pool.query(sql); // second application — must not throw
    const view = await pool.query(`SELECT * FROM all_samples_v LIMIT 0`);
    expect(view.fields.map((f) => f.name)).toContain('dispatched_on');
  });
});

describe('requested_by / completed_by (Muki)', () => {
  it('captures requested_by at create and completed_by via PATCH', async () => {
    const created = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Nyeri AA', receiver_company: 'Paulig', requested_by: 'Omar' });
    expect(created.status).toBe(201);
    expect(created.body.requested_by).toBe('Omar');

    const patched = await auth(request(app).patch(`/specialty-samples/${created.body.id}`))
      .send({ completed_by: 'Muki' });
    expect(patched.body.completed_by).toBe('Muki');
    expect(patched.body.requested_by).toBe('Omar');
  });
});

describe('stock on hand (Anicka)', () => {
  it('decrements stock by qty on dispatch, only once, floored at 0', async () => {
    const s = await auth(request(app).post('/bulk-samples'))
      .send({ quality: 'AB FAQ', client: 'Löfbergs', sample_type: 'type', qty_grams: 300, stock_grams: 500 });
    expect(s.body.stock_grams).toBe(500);

    const dispatched = await auth(request(app).patch(`/bulk-samples/${s.body.id}`))
      .send({ status: 'dispatched', courier_norm: 'dhl', awb: '111222333' });
    expect(dispatched.body.stock_grams).toBe(200);
    expect(dispatched.body.dispatched_on).toBeTruthy();

    // A second 'dispatched' PATCH is not a transition — no double decrement.
    const again = await auth(request(app).patch(`/bulk-samples/${s.body.id}`)).send({ status: 'dispatched' });
    expect(again.body.stock_grams).toBe(200);
    expect(again.body.dispatched_on).toBe(dispatched.body.dispatched_on);

    // Floor at 0: 200g left, 300g send.
    const s2 = await auth(request(app).post('/bulk-samples'))
      .send({ quality: 'AA PLUS', client: 'Löfbergs', sample_type: 'offer', qty_grams: 300, stock_grams: 200 });
    const d2 = await auth(request(app).patch(`/bulk-samples/${s2.body.id}`)).send({ status: 'dispatched' });
    expect(d2.body.stock_grams).toBe(0);
  });

  it('leaves untracked (NULL) stock untouched and supports editing stock directly', async () => {
    const s = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Embu AB', receiver_company: 'Paulig', qty_grams: 200 });
    const d = await auth(request(app).patch(`/specialty-samples/${s.body.id}`)).send({ status: 'dispatched' });
    expect(d.body.stock_grams).toBeNull();

    const restocked = await auth(request(app).patch(`/specialty-samples/${s.body.id}`)).send({ stock_grams: 900 });
    expect(restocked.body.stock_grams).toBe(900);
  });

  it('low_stock filter returns only rows short of their send quantity', async () => {
    const short = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Kirinyaga PB low', receiver_company: 'Ally Coffee', qty_grams: 500, stock_grams: 100 });
    await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Kirinyaga PB fine', receiver_company: 'Ally Coffee', qty_grams: 200, stock_grams: 800 });
    const list = await auth(request(app).get('/specialty-samples?low_stock=true&pageSize=100'));
    const ids = list.body.data.map((r: { id: string }) => r.id);
    expect(ids).toContain(short.body.id);
    for (const row of list.body.data) {
      expect(row.stock_grams).toBeLessThan(row.qty_grams);
    }
  });
});

describe('per-client phyto default (Anicka)', () => {
  let clientId: string;

  it('falls back to the client default when phyto_cert is not given', async () => {
    const c = await auth(request(app).post('/clients')).send({ name: 'Phyto Default GmbH', country: 'Germany' });
    clientId = c.body.id;
    await auth(request(app).patch(`/clients/${clientId}`)).send({ default_phyto_cert: 'Yes' });

    const s = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Meru AA', receiver_company: 'Phyto Default GmbH', client_id: clientId });
    expect(s.body.phyto_cert).toBe('Yes');

    const b = await auth(request(app).post('/bulk-samples'))
      .send({ quality: 'FAQ', client: 'Phyto Default GmbH', sample_type: 'pss', client_id: clientId });
    expect(b.body.phyto_cert).toBe('Yes');

    const f = await auth(request(app).post('/forwarding-samples'))
      .send({ sender: 'Mombasa', origin: 'Kenya', sample_ref: 'FWD-PHYTO-1', coffee_quality: 'AB', receiver_company: 'Phyto Default GmbH', client_id: clientId });
    expect(f.body.phyto_cert).toBe('Yes');
  });

  it('lets an explicit phyto_cert win over the default, and stays NULL with no client', async () => {
    const s = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Meru AB', receiver_company: 'Phyto Default GmbH', client_id: clientId, phyto_cert: 'No' });
    expect(s.body.phyto_cert).toBe('No');

    const orphan = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Meru PB', receiver_company: 'Someone Else' });
    expect(orphan.body.phyto_cert).toBeNull();
  });
});

describe('dispatched_on on forwarding rows born dispatched', () => {
  it('stamps dispatched_on when a forwarding sample is created with an AWB', async () => {
    const f = await auth(request(app).post('/forwarding-samples'))
      .send({ sender: 'Kampala', origin: 'Uganda', sample_ref: 'FWD-BORN-1', coffee_quality: 'Drugar', receiver_company: 'Olam', awb: '999888777' });
    expect(f.body.status).toBe('dispatched');
    expect(f.body.dispatched_on).toBeTruthy();
  });
});
