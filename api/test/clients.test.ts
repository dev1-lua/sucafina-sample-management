import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);

const auth = (r: request.Test) => r.set('x-api-key', API_KEY);

describe('clients', () => {
  it('rejects missing api key', async () => {
    const res = await request(app).get('/clients');
    expect(res.status).toBe(401);
  });

  let beyersId: string;

  it('creates a client with an inline contact', async () => {
    const res = await auth(request(app).post('/clients')).send({
      name: 'Beyers Koffie',
      country: 'Belgium',
      contact: { attention_to: 'Thomas Pitault', full_address: 'Koning Leopoldlaan 3, 2870 Puurs' },
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Beyers Koffie');
    beyersId = res.body.id;
  });

  it('upserts on duplicate name (case-insensitive)', async () => {
    const res = await auth(request(app).post('/clients')).send({ name: 'BEYERS KOFFIE' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(beyersId);
  });

  it('searches by partial name', async () => {
    const res = await auth(request(app).get('/clients?q=beyer'));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].name).toBe('Beyers Koffie');
  });

  it('gets client with contacts', async () => {
    const res = await auth(request(app).get(`/clients/${beyersId}`));
    expect(res.status).toBe(200);
    expect(res.body.contacts).toHaveLength(1);
    expect(res.body.contacts[0].attention_to).toBe('Thomas Pitault');
  });

  it('patches a client', async () => {
    const res = await auth(request(app).patch(`/clients/${beyersId}`)).send({ country: 'BE' });
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('BE');
  });

  it('validates bodies with zod', async () => {
    const res = await auth(request(app).post('/clients')).send({});
    expect(res.status).toBe(400);
  });

  it('returns the true match count as total', async () => {
    await auth(request(app).post('/clients')).send({ name: 'Beyers Retail' });
    const res = await auth(request(app).get('/clients?q=beyers'));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data).toHaveLength(2);
  });

  it('rejects malformed uuids with 400', async () => {
    const requests = [
      auth(request(app).get('/clients/not-a-uuid')),
      auth(request(app).patch('/clients/not-a-uuid')).send({ country: 'BE' }),
      auth(request(app).post('/clients/not-a-uuid/contacts')).send({ email: 'x@y.z' }),
    ];
    for (const req of requests) {
      const res = await req;
      expect(res.status).toBe(400);
    }
  });

  it('returns 404 when adding a contact to a nonexistent client', async () => {
    const res = await auth(
      request(app).post('/clients/00000000-0000-0000-0000-000000000000/contacts')
    ).send({ email: 'x@y.z' });
    expect(res.status).toBe(404);
  });
});
