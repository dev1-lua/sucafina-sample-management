import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('migration 011 idempotency', () => {
  it('re-applies cleanly and exposes priority in the view', async () => {
    const sql = readFileSync(fileURLToPath(new URL('../migrations/011_priority.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    const view = await pool.query(`SELECT * FROM all_samples_v LIMIT 0`);
    expect(view.fields.map((f) => f.name)).toContain('priority');
  });
});

describe('priority / urgency flag (feedback #25 — Ivo)', () => {
  it('defaults to normal, accepts urgent on create, and PATCHes back and forth on all three books', async () => {
    const b = await auth(request(app).post('/bulk-samples'))
      .send({ quality: 'AB FAQ', client: 'Folgers', sample_type: 'type' });
    expect(b.status).toBe(201);
    expect(b.body.priority).toBe('normal');

    const bu = await auth(request(app).post('/bulk-samples'))
      .send({ quality: 'ABC FAQ', client: 'Folgers', sample_type: 'type', priority: 'urgent' });
    expect(bu.body.priority).toBe('urgent');

    const flagged = await auth(request(app).patch(`/bulk-samples/${b.body.id}`)).send({ priority: 'urgent' });
    expect(flagged.body.priority).toBe('urgent');
    const cleared = await auth(request(app).patch(`/bulk-samples/${b.body.id}`)).send({ priority: 'normal' });
    expect(cleared.body.priority).toBe('normal');

    const s = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Nyeri AA', receiver_company: 'Paulig', priority: 'urgent' });
    expect(s.body.priority).toBe('urgent');

    const f = await auth(request(app).post('/forwarding-samples'))
      .send({ sender: 'Kenyacof', origin: 'Uganda', sample_ref: 'SSUG-1', coffee_quality: 'Robusta', receiver_company: 'Itochu', id_number: 'UGF/25/001', priority: 'urgent' });
    expect(f.status).toBe(201);
    expect(f.body.priority).toBe('urgent');
  });

  it('rejects values outside normal|urgent', async () => {
    const r = await auth(request(app).post('/bulk-samples'))
      .send({ quality: 'AB FAQ', client: 'Folgers', sample_type: 'type', priority: 'asap' });
    expect(r.status).toBe(400);
  });

  it('filters ?priority=urgent on the book lists and cross-book search, and sorts by priority', async () => {
    const list = await auth(request(app).get('/bulk-samples?priority=urgent'));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    for (const row of list.body.data) expect(row.priority).toBe('urgent');

    const search = await auth(request(app).get('/search?priority=urgent'));
    expect(search.status).toBe(200);
    expect(search.body.data.length).toBeGreaterThanOrEqual(3); // bulk + specialty + forwarding above
    for (const row of search.body.data) expect(row.priority).toBe('urgent');

    const sorted = await auth(request(app).get('/specialty-samples?sort=priority&order=desc'));
    expect(sorted.status).toBe(200);
    expect(sorted.body.data[0].priority).toBe('urgent');
  });
});

describe('client contacts merge instead of duplicating (Folgers, 2026-07-24)', () => {
  it('POST /clients on an existing name fills the matching contact row rather than adding a second one', async () => {
    const created = await auth(request(app).post('/clients'))
      .send({ name: 'Folgers Co', contact: { attention_to: 'Ivo Sarjanovic', phone: '+18327584587' } });
    expect(created.status).toBe(201);
    expect(created.body.country).toBeNull();

    // "Update the address" — same person, now with an address + country.
    const again = await auth(request(app).post('/clients'))
      .send({ name: 'Folgers Co', country: 'USA', contact: { attention_to: 'ivo sarjanovic', full_address: '1 Riverfront Drive, Brooklyn, 1201' } });
    expect(again.status).toBe(200);
    expect(again.body.country).toBe('USA');

    const detail = await auth(request(app).get(`/clients/${created.body.id}`));
    expect(detail.body.contacts).toHaveLength(1);
    expect(detail.body.contacts[0].phone).toBe('+18327584587');
    expect(detail.body.contacts[0].full_address).toBe('1 Riverfront Drive, Brooklyn, 1201');

    // A different person is still a new contact row.
    const other = await auth(request(app).post(`/clients/${created.body.id}/contacts`))
      .send({ attention_to: 'Someone Else', email: 'else@folgers.com' });
    expect(other.status).toBe(201);
    const detail2 = await auth(request(app).get(`/clients/${created.body.id}`));
    expect(detail2.body.contacts).toHaveLength(2);

    // Matching by email merges too, and never overwrites an existing address.
    const merged = await auth(request(app).post(`/clients/${created.body.id}/contacts`))
      .send({ email: 'ELSE@folgers.com', phone: '+100' });
    expect(merged.body.attention_to).toBe('Someone Else');
    expect(merged.body.phone).toBe('+100');
    const detail3 = await auth(request(app).get(`/clients/${created.body.id}`));
    expect(detail3.body.contacts).toHaveLength(2);
  });

  it('does not overwrite a country already on file', async () => {
    const c = await auth(request(app).post('/clients')).send({ name: 'Paulig Oy', country: 'Finland' });
    const again = await auth(request(app).post('/clients')).send({ name: 'Paulig Oy', country: 'Sweden' });
    expect(again.body.country).toBe('Finland');
    expect(again.body.id).toBe(c.body.id);
  });
});
