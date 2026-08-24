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

  it('patches email / role / active by id', async () => {
    const created = await auth(request(app).post('/traders')).send({ name: 'Patch Me', role: 'trader' });
    const id = created.body.id;
    const patched = await auth(request(app).patch(`/traders/${id}`)).send({ email: 'Patch.Me@Sucafina.COM', role: 'qc' });
    expect(patched.status).toBe(200);
    expect(patched.body.email).toBe('patch.me@sucafina.com'); // lowercased
    expect(patched.body.role).toBe('qc');
    expect(patched.body.name).toBe('Patch Me'); // name untouched

    const off = await auth(request(app).patch(`/traders/${id}`)).send({ active: false });
    expect(off.body.active).toBe(false);
  });

  it('patch clears an email with null', async () => {
    const created = await auth(request(app).post('/traders')).send({ name: 'Clearable', email: 'x@y.com' });
    const res = await auth(request(app).patch(`/traders/${created.body.id}`)).send({ email: null });
    expect(res.status).toBe(200);
    expect(res.body.email).toBeNull();
  });

  it('patch rejects an invalid email, an empty body, and an unknown id', async () => {
    const created = await auth(request(app).post('/traders')).send({ name: 'Strict' });
    const id = created.body.id;
    expect((await auth(request(app).patch(`/traders/${id}`)).send({ email: 'not-an-email' })).status).toBe(400);
    expect((await auth(request(app).patch(`/traders/${id}`)).send({})).status).toBe(400);
    expect((await auth(request(app).patch('/traders/6b951778-080b-4cf4-9bd8-ec9251774669')).send({ role: 'qc' })).status).toBe(404);
  });

  it('default list hides inactive; ?all=1 shows them (inactive last)', async () => {
    const created = await auth(request(app).post('/traders')).send({ name: 'Ghost', role: 'trader' });
    await auth(request(app).patch(`/traders/${created.body.id}`)).send({ active: false });
    const dflt = await auth(request(app).get('/traders'));
    expect(dflt.body.data.some((t: { name: string }) => t.name === 'Ghost')).toBe(false);
    const all = await auth(request(app).get('/traders?all=1'));
    const ghost = all.body.data.find((t: { name: string }) => t.name === 'Ghost');
    expect(ghost.active).toBe(false);
  });
});
