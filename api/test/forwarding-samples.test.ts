import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('forwarding-samples', () => {
  let id: string;

  it('creates a forwarding sample with a created event', async () => {
    const res = await auth(request(app).post('/forwarding-samples')).send({
      sender: 'Kenyacof', origin: 'Uganda', sample_ref: 'SSUG-97044', coffee_quality: 'Bugisu AA',
      receiver_company: 'Beyers', id_number: 'UGF/25/026', awb: 'Y0231587772', courier_norm: 'dhl',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('dispatched'); // has awb+courier
    id = res.body.id;
    const d = await auth(request(app).get(`/forwarding-samples/${id}`));
    expect(d.body.events[0]).toMatchObject({ type: 'created', entity_type: 'forwarding' });
  });

  it('rejects a create missing required fields', async () => {
    expect((await auth(request(app).post('/forwarding-samples')).send({ origin: 'Uganda' })).status).toBe(400);
  });

  it('NEVER derives results_in (no result field accepted)', async () => {
    const res = await auth(request(app).patch(`/forwarding-samples/${id}`)).send({ status: 'delivered' });
    expect(res.body.status).toBe('delivered');
    // even if a client sends result_norm, it is ignored by the schema and status stays put
    const res2 = await auth(request(app).patch(`/forwarding-samples/${id}`)).send({ result_norm: 'approved' } as unknown as object);
    expect(res2.body.status).not.toBe('results_in');
  });

  it('filters by has_id and origin', async () => {
    await auth(request(app).post('/forwarding-samples')).send({
      sender: 'Kenyacof', origin: 'Burundi', sample_ref: 'SSBI-95623', coffee_quality: 'Kayanza',
      receiver_company: 'Beyers', // no id_number
    });
    const withId = await auth(request(app).get('/forwarding-samples?has_id=true'));
    expect(withId.body.total).toBe(1);
    const byOrigin = await auth(request(app).get('/forwarding-samples?origin=Burundi'));
    expect(byOrigin.body.total).toBe(1);
  });

  it('soft-deletes', async () => {
    await auth(request(app).delete(`/forwarding-samples/${id}`));
    const d = await auth(request(app).get(`/forwarding-samples/${id}`));
    expect(d.body.events.map((e: { type: string }) => e.type)).toContain('deleted');
  });

  it('defaults date + date_on to Nairobi today when none is given', async () => {
    const res = await auth(request(app).post('/forwarding-samples')).send({
      sender: 'Kenyacof', origin: 'Uganda', sample_ref: 'DATE-1', coffee_quality: 'AA',
      receiver_company: 'Beyers', id_number: 'DATE/1',
    });
    expect(res.status).toBe(201);
    const nairobiToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
    const { rows } = await pool.query(`SELECT date::text AS d, date_on::text AS don FROM forwarding_samples WHERE id = $1`, [res.body.id]);
    expect(rows[0].d).toBe(nairobiToday);
    expect(rows[0].don).toBe(nairobiToday);
    expect(res.body.date).toBe(nairobiToday);
  });

  it('roundtrips phyto_cert on create and patch', async () => {
    const created = await auth(request(app).post('/forwarding-samples')).send({
      sender: 'Kenyacof', origin: 'Uganda', sample_ref: 'PHYTO-1', coffee_quality: 'AA',
      receiver_company: 'Beyers', phyto_cert: 'Yes',
    });
    expect(created.status).toBe(201);
    expect(created.body.phyto_cert).toBe('Yes');
    const patched = await auth(request(app).patch(`/forwarding-samples/${created.body.id}`)).send({ phyto_cert: 'Client to confirm' });
    expect(patched.body.phyto_cert).toBe('Client to confirm');
  });
});
