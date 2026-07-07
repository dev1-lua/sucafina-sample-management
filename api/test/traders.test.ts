import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY);

describe('traders', () => {
  it('creates a trader', async () => {
    const res = await auth(request(app).post('/traders')).send({ name: 'Omar', role: 'trader' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Omar');
    expect(res.body.role).toBe('trader');
  });

  it('is idempotent on name (upsert, not duplicate)', async () => {
    await auth(request(app).post('/traders')).send({ name: 'Omar', role: 'qc' });
    const list = await auth(request(app).get('/traders'));
    const omars = list.body.data.filter((t: { name: string }) => t.name === 'Omar');
    expect(omars).toHaveLength(1);
    expect(omars[0].role).toBe('qc'); // updated
  });

  it('rejects an invalid role', async () => {
    expect((await auth(request(app).post('/traders')).send({ name: 'X', role: 'boss' })).status).toBe(400);
  });

  it('lists traders name-ascending', async () => {
    await auth(request(app).post('/traders')).send({ name: 'Anička', role: 'qc' });
    const res = await auth(request(app).get('/traders'));
    expect(res.body.data[0].name).toBe('Anička');
  });
});
