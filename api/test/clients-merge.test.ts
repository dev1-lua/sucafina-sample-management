import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

async function mkClient(name: string, extra: Record<string, unknown> = {}, contact?: Record<string, unknown>) {
  const { country, ...patch } = extra;
  const r = await auth(request(app).post('/clients')).send({ name, contact, ...(country ? { country } : {}) });
  expect([200, 201]).toContain(r.status);
  if (Object.keys(patch).length) await auth(request(app).patch(`/clients/${r.body.id}`)).send(patch);
  return r.body.id as string;
}

describe('migration 012 idempotency', () => {
  it('re-applies cleanly and the enum carries merged / merged_into', async () => {
    const sql = readFileSync(fileURLToPath(new URL('../migrations/012_client_merge_events.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    const { rows } = await pool.query(`SELECT unnest(enum_range(NULL::entity_event_t))::text AS v`);
    const values = rows.map((r) => r.v);
    expect(values).toContain('merged');
    expect(values).toContain('merged_into');
  });
});

describe('POST /clients/:id/merge (feedback #27 — Paulig duplicates)', () => {
  let target: string; let source: string; let source2: string;

  it('happy path: re-points samples across books, folds contacts, fills nulls, soft-deletes sources, writes events', async () => {
    target = await mkClient('Gustav Paulig Ltd (NEW) Jan 23', { country: 'Finland' },
      { attention_to: 'Anna Virtanen', full_address: 'Satamakaari 20, Helsinki', phone: '+358401234567' });
    source = await mkClient('Paulig', { spec_grades: 'AB FAQ', default_phyto_cert: 'yes' },
      { attention_to: 'anna virtanen', email: 'anna@paulig.fi' });
    // A second, distinct person on the source — must arrive on the target as a NEW row.
    await auth(request(app).post(`/clients/${source}/contacts`)).send({ attention_to: 'Mikko L', phone: '+358409999999' });
    source2 = await mkClient('Paulig Finlanad ltd');

    // One sample per book pointing at the sources. Free text equal to a source name (→ rewritten) and
    // one legacy variant that must stay untouched.
    const s = await auth(request(app).post('/specialty-samples')).send({ description: 'Nyeri AA', receiver_company: 'Paulig', client_id: source });
    const b = await auth(request(app).post('/bulk-samples')).send({ quality: 'AB FAQ', client: 'PAULIG', sample_type: 'type', client_id: source });
    const b2 = await auth(request(app).post('/bulk-samples')).send({ quality: 'AB FAQ', client: 'Gustav Paulig', sample_type: 'type', client_id: source });
    const f = await auth(request(app).post('/forwarding-samples')).send({
      sender: 'Kenyacof', origin: 'Uganda', sample_ref: 'SSUG-9', coffee_quality: 'Robusta', receiver_company: 'Paulig Finlanad ltd', id_number: 'UGF/25/009', client_id: source2,
    });
    expect(s.status).toBe(201); expect(b.status).toBe(201); expect(b2.status).toBe(201); expect(f.status).toBe(201);
    // Legacy table row (no API route writes it any more) — repoint must cover it too.
    await pool.query(`INSERT INTO samples (ref, client_id, receiver) VALUES ('LEG-1', $1, 'Paulig')`, [source]);

    const r = await auth(request(app).post(`/clients/${target}/merge`)).send({ source_ids: [source, source2] });
    expect(r.status).toBe(200);
    expect(r.body.target.id).toBe(target);
    expect(r.body.merged.map((m: any) => m.id).sort()).toEqual([source, source2].sort());
    expect(r.body.merged.find((m: any) => m.id === source).name).toBe('Paulig');
    expect(r.body.repointed).toEqual({ specialty: 1, bulk: 2, forwarding: 1, legacy: 1 });
    // contacts_folded = source contact rows processed (anna → merged into existing, Mikko → new row).
    expect(r.body.contacts_folded).toBe(2);
    // COALESCE-fill from sources; never overwrite target values.
    expect(r.body.target.country).toBe('Finland');
    expect(r.body.target.spec_grades).toBe('AB FAQ');
    expect(r.body.target.default_phyto_cert).toBe('yes');

    // Sample rows now point at target; free text rewritten only where it equalled a source name.
    const sp = await pool.query(`SELECT client_id, receiver_company FROM specialty_samples WHERE id = $1`, [s.body.id]);
    expect(sp.rows[0]).toEqual({ client_id: target, receiver_company: 'Gustav Paulig Ltd (NEW) Jan 23' });
    const bk = await pool.query(`SELECT id, client_id, client FROM bulk_samples WHERE id = ANY($1::uuid[])`, [[b.body.id, b2.body.id]]);
    expect(bk.rows.find((x) => x.id === b.body.id)).toMatchObject({ client_id: target, client: 'Gustav Paulig Ltd (NEW) Jan 23' });
    expect(bk.rows.find((x) => x.id === b2.body.id)).toMatchObject({ client_id: target, client: 'Gustav Paulig' }); // legacy variant untouched
    const fw = await pool.query(`SELECT client_id, receiver_company FROM forwarding_samples WHERE id = $1`, [f.body.id]);
    expect(fw.rows[0]).toEqual({ client_id: target, receiver_company: 'Gustav Paulig Ltd (NEW) Jan 23' });
    const lg = await pool.query(`SELECT client_id, receiver FROM samples WHERE ref = 'LEG-1'`);
    expect(lg.rows[0]).toEqual({ client_id: target, receiver: 'Gustav Paulig Ltd (NEW) Jan 23' });

    // Contacts: no duplicate Anna, Mikko added, source contacts gone.
    const detail = await auth(request(app).get(`/clients/${target}`));
    const names = detail.body.contacts.map((c: any) => c.attention_to.toLowerCase()).sort();
    expect(names).toEqual(['anna virtanen', 'mikko l']);
    const anna = detail.body.contacts.find((c: any) => c.attention_to === 'Anna Virtanen');
    expect(anna.email).toBe('anna@paulig.fi');
    expect(anna.full_address).toBe('Satamakaari 20, Helsinki');
    const leftover = await pool.query(`SELECT count(*)::int AS n FROM client_contacts WHERE client_id = ANY($1::uuid[])`, [[source, source2]]);
    expect(leftover.rows[0].n).toBe(0);

    // Sources soft-deleted and gone from the list; events written on both sides.
    const list = await auth(request(app).get('/clients?q=paulig'));
    expect(list.body.data.map((c: any) => c.id)).toEqual([target]);
    const src = await pool.query(`SELECT deleted_at FROM clients WHERE id = $1`, [source]);
    expect(src.rows[0].deleted_at).not.toBeNull();
    const tEv = detail.body.events.filter((e: any) => e.type === 'merged');
    expect(tEv).toHaveLength(1);
    expect(tEv[0].note).toContain('Paulig');
    expect(tEv[0].note).toContain(source);
    const sEv = await pool.query(`SELECT type, note FROM events WHERE entity_type = 'client' AND entity_id = $1 AND type = 'merged_into'`, [source]);
    expect(sEv.rows).toHaveLength(1);
    expect(sEv.rows[0].note).toContain(target);
  });

  it('renames the target and sidesteps a soft-deleted row holding that name', async () => {
    // "Paulig" is now soft-deleted but still holds the name (unique index on lower(name)).
    const r = await auth(request(app).post(`/clients/${target}/merge`)).send({ source_ids: [], name: 'PAULIG' });
    expect(r.status).toBe(200);
    expect(r.body.target.name).toBe('PAULIG');
    const ghost = await pool.query(`SELECT name FROM clients WHERE id = $1`, [source]);
    expect(ghost.rows[0].name).toMatch(/^Paulig \(merged [0-9a-f]{8}\)$/);
  });

  it('refuses to rename onto a LIVE client name', async () => {
    await mkClient('Löfbergs');
    const r = await auth(request(app).post(`/clients/${target}/merge`)).send({ source_ids: [], name: 'löfbergs' });
    expect(r.status).toBe(409);
  });

  it('refuses when target is among the sources', async () => {
    const r = await auth(request(app).post(`/clients/${target}/merge`)).send({ source_ids: [target] });
    expect(r.status).toBe(400);
  });

  it('refuses when a source is missing or already deleted', async () => {
    const gone = await auth(request(app).post(`/clients/${target}/merge`)).send({ source_ids: [source] }); // soft-deleted above
    expect(gone.status).toBe(404);
    const missing = await auth(request(app).post(`/clients/${target}/merge`)).send({ source_ids: ['00000000-0000-0000-0000-000000000000'] });
    expect(missing.status).toBe(404);
    const badTarget = await auth(request(app).post(`/clients/${source}/merge`)).send({ source_ids: [] });
    expect(badTarget.status).toBe(404);
  });

  it('refuses to merge an internal Sucafina office into an external client (and vice versa)', async () => {
    const office = await mkClient('Sucafina Geneva');
    const r1 = await auth(request(app).post(`/clients/${target}/merge`)).send({ source_ids: [office] });
    expect(r1.status).toBe(400);
    expect(r1.body.error).toMatch(/internal/i);
    const r2 = await auth(request(app).post(`/clients/${office}/merge`)).send({ source_ids: [target] });
    expect(r2.status).toBe(400);
  });

  it('validates the body', async () => {
    const r = await auth(request(app).post(`/clients/${target}/merge`)).send({ source_ids: ['nope'] });
    expect(r.status).toBe(400);
  });
});

describe('GET /clients/:id/merge-candidates', () => {
  it('lists live clients whose normalized name matches, excluding self and deleted rows', async () => {
    const a = await mkClient('Beyers Koffie NV');
    const b = await mkClient('Beyers Koffie');
    const c = await mkClient('BEYERS-KOFFIE (NEW) Jan 23');
    await mkClient('Beyers Trading');   // different normalized name → not a candidate
    const del = await mkClient('Beyers Koffie Ltd');
    await auth(request(app).delete(`/clients/${del}`));

    const r = await auth(request(app).get(`/clients/${a}/merge-candidates`));
    expect(r.status).toBe(200);
    const ids = r.body.data.map((x: any) => x.id).sort();
    expect(ids).toEqual([b, c].sort());
    expect(r.body.data[0]).toHaveProperty('contact_count');
    expect(r.body.data[0]).toHaveProperty('sample_count');
    expect(r.body.normalized).toBe('beyers koffie');
  });

  it('404s on a deleted or unknown client', async () => {
    const r = await auth(request(app).get(`/clients/00000000-0000-0000-0000-000000000000/merge-candidates`));
    expect(r.status).toBe(404);
  });
});
