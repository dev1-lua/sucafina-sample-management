import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

// "When the AWB is added it means the coffee is awaiting collection by DHL" (lifecycle sketch,
// 2026-09-14). Derived, never stored: an AWB on file while the row is still requested/preparing.
describe('awaiting_collection', () => {
  const BOOKS: Array<{ path: string; body: Record<string, unknown> }> = [
    { path: '/specialty-samples', body: { description: 'Awaiting spec', receiver_company: 'WaitCo' } },
    { path: '/bulk-samples', body: { quality: 'Awaiting bulk', client: 'WaitCo' } },
    { path: '/forwarding-samples', body: { sender: 'Origin', origin: 'Ethiopia', sample_ref: 'FWD-W1', coffee_quality: 'G1', receiver_company: 'WaitCo', id_number: 'ID-W1' } },
  ];

  for (const { path, body } of BOOKS) {
    it(`${path}: true once an AWB lands, false again after dispatch`, async () => {
      const s = await auth(request(app).post(path)).send(body);
      expect((await auth(request(app).get(`${path}/${s.body.id}`))).body.awaiting_collection).toBe(false);

      await auth(request(app).patch(`${path}/${s.body.id}`)).send({ awb: `AWB-${s.body.id.slice(0, 6)}` });
      const detail = await auth(request(app).get(`${path}/${s.body.id}`));
      expect(detail.body.status).toBe('requested');
      expect(detail.body.awaiting_collection).toBe(true);

      const filtered = await auth(request(app).get(`${path}?awaiting_collection=true&pageSize=100`));
      expect(filtered.body.data.map((r: { id: string }) => r.id)).toContain(s.body.id);
      const row = filtered.body.data.find((r: { id: string }) => r.id === s.body.id);
      expect(row.awaiting_collection).toBe(true);

      await auth(request(app).patch(`${path}/${s.body.id}`)).send({ status: 'dispatched' });
      expect((await auth(request(app).get(`${path}/${s.body.id}`))).body.awaiting_collection).toBe(false);
      const after = await auth(request(app).get(`${path}?awaiting_collection=true&pageSize=100`));
      expect(after.body.data.map((r: { id: string }) => r.id)).not.toContain(s.body.id);
    });
  }

  it('an empty-string AWB does not count', async () => {
    const s = await auth(request(app).post('/specialty-samples')).send({ description: 'Blank AWB', receiver_company: 'WaitCo', awb: '' });
    expect((await auth(request(app).get(`/specialty-samples/${s.body.id}`))).body.awaiting_collection).toBe(false);
  });

  it('/search carries the flag and filters on it', async () => {
    const s = await auth(request(app).post('/bulk-samples')).send({ quality: 'Search awaiting', client: 'WaitCo' });
    await auth(request(app).patch(`/bulk-samples/${s.body.id}`)).send({ awb: 'SRCH-WAIT-1' });
    const hit = await auth(request(app).get('/search?awb=SRCH-WAIT-1'));
    expect(hit.body.data[0].awaiting_collection).toBe(true);
    const only = await auth(request(app).get('/search?awaiting_collection=true&pageSize=100'));
    expect(only.body.data.every((r: { awaiting_collection: boolean }) => r.awaiting_collection === true)).toBe(true);
    expect(only.body.data.map((r: { id: string }) => r.id)).toContain(s.body.id);
  });
});
