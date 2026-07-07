import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('clients upgrades', () => {
  let clientId: string;
  let traderId: string;

  it('sets up a client + trader', async () => {
    const c = await auth(request(app).post('/clients')).send({ name: 'Beyers', country: 'Belgium' });
    clientId = c.body.id;
    const t = await auth(request(app).post('/traders')).send({ name: 'Omar', role: 'trader' });
    traderId = t.body.id;
  });

  it('assigns an account owner via PATCH and joins it in GET /:id', async () => {
    await auth(request(app).patch(`/clients/${clientId}`)).send({ account_owner_id: traderId });
    const res = await auth(request(app).get(`/clients/${clientId}`));
    expect(res.body.account_owner).toMatchObject({ name: 'Omar' });
  });

  it('drills down into orders across all three tables', async () => {
    await auth(request(app).post('/specialty-samples')).send({ description: 'AB', receiver_company: 'Beyers', client_id: clientId });
    await auth(request(app).post('/bulk-samples')).send({ quality: 'AA', client: 'Beyers', client_id: clientId });
    const res = await auth(request(app).get(`/clients/${clientId}`));
    const tabs = res.body.orders.map((o: { tab: string }) => o.tab).sort();
    expect(tabs).toEqual(['bulk', 'specialty']);
  });

  it('sorts clients by latest_order_date', async () => {
    await auth(request(app).post('/clients')).send({ name: 'Nestrade' }); // no orders
    const res = await auth(request(app).get('/clients?sort=latest_order_date&order=desc'));
    expect(res.body.data[0].name).toBe('Beyers'); // has the most recent order
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it('paginates', async () => {
    const res = await auth(request(app).get('/clients?pageSize=1'));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
  });

  it('soft-deletes a client and hides it from the list + logs a deleted event', async () => {
    const del = await auth(request(app).delete(`/clients/${clientId}`));
    expect(del.status).toBe(200);
    const list = await auth(request(app).get('/clients'));
    expect(list.body.data.find((c: { id: string }) => c.id === clientId)).toBeUndefined();
    const d = await auth(request(app).get(`/clients/${clientId}`));
    expect(d.body.events.map((e: { type: string }) => e.type)).toContain('deleted');
  });
});
