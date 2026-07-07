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
});
