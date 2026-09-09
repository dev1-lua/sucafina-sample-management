import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';

// Migration 016 — "log first, complete later" (Beyers, 2026-09-08): a sample is written before the
// client's delivery address exists; the gap is flagged on every read, the ask is recorded once per
// client, and the desk chases it until the address lands.

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

async function makeClient(name: string, contact?: Record<string, string>, country = 'Belgium') {
  const res = await auth(request(app).post('/clients')).send({ name, country, ...(contact ? { contact } : {}) });
  return res.body.id as string;
}

async function makeBulk(client: string, clientId: string, quality = 'AB FAQ') {
  const res = await auth(request(app).post('/bulk-samples'))
    .send({ quality, client, sample_type: 'type', client_id: clientId, country: 'Belgium', qty_grams: 2500 });
  return res.body.id as string;
}

describe('client_address_missing (function + GET /clients)', () => {
  it('is true for an external client with no contact, false once a street address is on file', async () => {
    const id = await makeClient('Beyers Koffie');
    let c = await auth(request(app).get(`/clients/${id}`));
    expect(c.body.address_missing).toBe(true);
    expect(c.body.detail_request).toBeNull();

    await auth(request(app).post(`/clients/${id}/contacts`)).send({ attention_to: 'Thomas P', phone: '+32 52 30 00 30' });
    c = await auth(request(app).get(`/clients/${id}`));
    expect(c.body.address_missing).toBe(true); // phone alone is not an address

    await auth(request(app).post(`/clients/${id}/contacts`)).send({ attention_to: 'Thomas P', full_address: 'Koning Leopoldlaan 3, 2870 Puurs' });
    c = await auth(request(app).get(`/clients/${id}`));
    expect(c.body.address_missing).toBe(false);
  });

  it('is false for internal Sucafina / Kenyacof offices even with no contact', async () => {
    const a = await makeClient('Sucafina Argentina', undefined, 'Argentina');
    const k = await makeClient('Kenyacof Thika', undefined, 'Kenya');
    expect((await auth(request(app).get(`/clients/${a}`))).body.address_missing).toBe(false);
    expect((await auth(request(app).get(`/clients/${k}`))).body.address_missing).toBe(false);
  });

  it('is exposed per row on the client list', async () => {
    const list = await auth(request(app).get('/clients?q=Beyers Koffie'));
    const row = list.body.data.find((r: { name: string }) => r.name === 'Beyers Koffie');
    expect(row.address_missing).toBe(false);
  });
});

describe('sample reads carry the gap', () => {
  let gapClient: string;
  let okClient: string;
  let gapSample: string;
  let okSample: string;

  beforeAll(async () => {
    gapClient = await makeClient('Gap Roasters');
    okClient = await makeClient('Addressed Roasters', { attention_to: 'Ann', full_address: '1 Rue du Rhône, Geneva' }, 'Switzerland');
    gapSample = await makeBulk('Gap Roasters', gapClient);
    okSample = await makeBulk('Addressed Roasters', okClient);
  });

  it('list rows expose client_address_missing / details_requested_*', async () => {
    const list = await auth(request(app).get(`/bulk-samples?client_id=${gapClient}`));
    expect(list.status).toBe(200);
    const row = list.body.data.find((r: { id: string }) => r.id === gapSample);
    expect(row.client_address_missing).toBe(true);
    expect(row.details_requested_from).toBeNull();
    const ok = await auth(request(app).get(`/bulk-samples?client_id=${okClient}`));
    expect(ok.body.data.find((r: { id: string }) => r.id === okSample).client_address_missing).toBe(false);
  });

  it('?address_missing=true filters the list, GET /:id and /search carry the columns', async () => {
    const list = await auth(request(app).get('/bulk-samples?address_missing=true'));
    const ids = list.body.data.map((r: { id: string }) => r.id);
    expect(ids).toContain(gapSample);
    expect(ids).not.toContain(okSample);

    const one = await auth(request(app).get(`/bulk-samples/${gapSample}`));
    expect(one.body.client_address_missing).toBe(true);

    const s = await auth(request(app).get('/search?q=AB FAQ&address_missing=true'));
    const sids = s.body.data.map((r: { id: string }) => r.id);
    expect(sids).toContain(gapSample);
    expect(sids).not.toContain(okSample);
    expect(s.body.data.find((r: { id: string }) => r.id === gapSample).client_address_missing).toBe(true);
  });

  it('existing filters and search still work alongside the extra columns', async () => {
    const list = await auth(request(app).get(`/bulk-samples?q=AB FAQ&client_id=${gapClient}&priority=normal`));
    expect(list.status).toBe(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).toEqual([gapSample]);
  });

  it('a sample with no client link is never flagged', async () => {
    const res = await auth(request(app).post('/specialty-samples')).send({ description: 'Walk-in AA', receiver_company: 'Someone' });
    const one = await auth(request(app).get(`/specialty-samples/${res.body.id}`));
    expect(one.body.client_address_missing).toBe(false);
  });
});

describe('POST /clients/:id/detail-requests', () => {
  let clientId: string;
  let sampleId: string;
  let second: string;

  beforeAll(async () => {
    clientId = await makeClient('Beyers NV');
    sampleId = await makeBulk('Beyers NV', clientId);
    second = await makeBulk('Beyers NV', clientId, 'ABC FAQ');
  });

  it('records the ask once per client, with events on the client and the samples', async () => {
    const res = await auth(request(app).post(`/clients/${clientId}/detail-requests`)).send({
      missing: ['full street address', 'phone'],
      asked_name: 'Tommie Schretlen',
      asked_email: 'tommie.schretlen@sucafina.com',
      asked_by: 'Ivo Jr. Sarjanovic',
      asked_by_email: 'ivo@sucafina.com',
      note: 'the lab has the address',
      via: 'email',
      samples: [{ tab: 'bulk', id: sampleId }],
    });
    expect(res.status).toBe(201);
    expect(res.body.request.asked_name).toBe('Tommie Schretlen');
    expect(res.body.request.via).toBe('email');
    expect(res.body.request.delivered_at).toBeTruthy();
    expect(res.body.request.resolved_at).toBeNull();
    // both open samples for the client come back, not only the one passed
    expect(res.body.open_samples.map((s: { id: string }) => s.id).sort()).toEqual([sampleId, second].sort());

    const c = await auth(request(app).get(`/clients/${clientId}`));
    expect(c.body.detail_request.asked_name).toBe('Tommie Schretlen');
    expect(c.body.events.some((e: { type: string }) => e.type === 'details_requested')).toBe(true);
    const s = await auth(request(app).get(`/bulk-samples/${sampleId}`));
    expect(s.body.details_requested_from).toBe('Tommie Schretlen');
    expect(s.body.details_requested_at).toBeTruthy();
    expect(s.body.events.some((e: { type: string; note: string }) => e.type === 'details_requested' && /Tommie/.test(e.note))).toBe(true);
  });

  it('a second ask for the same client updates the open row instead of adding one', async () => {
    const res = await auth(request(app).post(`/clients/${clientId}/detail-requests`)).send({
      missing: ['full street address'],
      asked_name: 'Harriet',
      asked_email: 'harriet.muthoni@sucafina.com',
      via: null,
    });
    expect(res.status).toBe(201);
    const { rows } = await pool.query(`SELECT * FROM client_detail_requests WHERE client_id = $1 AND resolved_at IS NULL`, [clientId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].asked_name).toBe('Harriet');
    // an undelivered re-ask keeps the earlier delivery stamp + channel
    expect(rows[0].via).toBe('email');
    expect(rows[0].note).toBe('the lab has the address');
  });

  it('404 for an unknown client, 409 when the address is already on file', async () => {
    const nope = await auth(request(app).post('/clients/00000000-0000-0000-0000-000000000000/detail-requests')).send({ missing: ['x'] });
    expect(nope.status).toBe(404);
    const done = await makeClient('Done Roasters', { attention_to: 'Z', full_address: 'Somewhere 1' });
    const res = await auth(request(app).post(`/clients/${done}/detail-requests`)).send({ missing: ['full street address'] });
    expect(res.status).toBe(409);
  });

  it('saving the address closes the open ask and writes details_resolved', async () => {
    await auth(request(app).post(`/clients/${clientId}/contacts`)).send({ attention_to: 'Thomas P', full_address: 'Koning Leopoldlaan 3' });
    const c = await auth(request(app).get(`/clients/${clientId}`));
    expect(c.body.address_missing).toBe(false);
    expect(c.body.detail_request).toBeNull();
    expect(c.body.events.some((e: { type: string }) => e.type === 'details_resolved')).toBe(true);
    const s = await auth(request(app).get(`/bulk-samples/${sampleId}`));
    expect(s.body.client_address_missing).toBe(false);
    expect(s.body.details_requested_from).toBeNull();
    expect(s.body.events.some((e: { type: string }) => e.type === 'details_resolved')).toBe(true);
  });

  it('POST /clients (existing name + contact with address) also resolves', async () => {
    const id = await makeClient('Upsert Roasters');
    const s = await makeBulk('Upsert Roasters', id);
    await auth(request(app).post(`/clients/${id}/detail-requests`)).send({ missing: ['full street address'], samples: [{ tab: 'bulk', id: s }] });
    await auth(request(app).post('/clients')).send({ name: 'Upsert Roasters', contact: { attention_to: 'Q', full_address: 'Street 9' } });
    const c = await auth(request(app).get(`/clients/${id}`));
    expect(c.body.detail_request).toBeNull();
  });
});

describe('details-pending / details-mark (the daily chase)', () => {
  let clientId: string;
  let sampleId: string;
  let reqId: string;

  beforeAll(async () => {
    clientId = await makeClient('Chase Roasters');
    sampleId = await makeBulk('Chase Roasters', clientId);
    const res = await auth(request(app).post(`/clients/${clientId}/detail-requests`)).send({
      missing: ['full street address'], asked_name: 'Tommie', asked_email: 'tommie@sucafina.com', asked_by_email: 'ivo@sucafina.com',
    });
    reqId = res.body.request.id;
  });

  const pendingIds = async () => {
    const res = await auth(request(app).get('/notifications/details-pending'));
    expect(res.status).toBe(200);
    return res.body.items as Array<{ id: string; samples: { id: string }[]; client_name: string; asked_email: string; days_open: number }>;
  };

  it('is due immediately when nothing was ever delivered', async () => {
    const items = await pendingIds();
    const item = items.find((i) => i.id === reqId)!;
    expect(item).toBeTruthy();
    expect(item.client_name).toBe('Chase Roasters');
    expect(item.samples.map((s) => s.id)).toEqual([sampleId]);
    expect(item.asked_email).toBe('tommie@sucafina.com');
  });

  it('marking a chase stamps via/chase_count and is not due again for ~20h', async () => {
    const mark = await auth(request(app).post('/notifications/details-mark')).send({ id: reqId, via: 'email', detail: 'Tommie (email)' });
    expect(mark.status).toBe(200);
    const { rows } = await pool.query(`SELECT * FROM client_detail_requests WHERE id = $1`, [reqId]);
    expect(rows[0].chase_count).toBe(1);
    expect(rows[0].via).toBe('email');
    expect(rows[0].delivered_at).toBeTruthy();
    expect((await pendingIds()).map((i) => i.id)).not.toContain(reqId);
    const s = await auth(request(app).get(`/bulk-samples/${sampleId}`));
    expect(s.body.events.some((e: { type: string }) => e.type === 'details_chased')).toBe(true);

    await pool.query(`UPDATE client_detail_requests SET last_chased_at = now() - interval '21 hours' WHERE id = $1`, [reqId]);
    expect((await pendingIds()).map((i) => i.id)).toContain(reqId);
  });

  it('a skipped chase counts an attempt but leaves via/delivered_at alone; escalation is stamped once', async () => {
    const fresh = await makeClient('Skip Roasters');
    await makeBulk('Skip Roasters', fresh);
    const r = await auth(request(app).post(`/clients/${fresh}/detail-requests`)).send({ missing: ['full street address'] });
    await auth(request(app).post('/notifications/details-mark')).send({ id: r.body.request.id, via: 'skipped', detail: 'nobody reachable', escalated: true });
    const { rows } = await pool.query(`SELECT * FROM client_detail_requests WHERE id = $1`, [r.body.request.id]);
    expect(rows[0].chase_count).toBe(1);
    expect(rows[0].via).toBeNull();
    expect(rows[0].delivered_at).toBeNull();
    expect(rows[0].escalated_at).toBeTruthy();
  });

  it('drops out once the client has no open sample or the address is on file', async () => {
    await pool.query(`UPDATE client_detail_requests SET last_chased_at = now() - interval '21 hours' WHERE id = $1`, [reqId]);
    await auth(request(app).patch(`/bulk-samples/${sampleId}`)).send({ status: 'cancelled' });
    expect((await pendingIds()).map((i) => i.id)).not.toContain(reqId);

    const again = await makeBulk('Chase Roasters', clientId, 'PB');
    expect((await pendingIds()).map((i) => i.id)).toContain(reqId);
    await auth(request(app).post(`/clients/${clientId}/contacts`)).send({ attention_to: 'A', full_address: 'Now on file 1' });
    expect((await pendingIds()).map((i) => i.id)).not.toContain(reqId);
    expect((await auth(request(app).get(`/bulk-samples/${again}`))).body.client_address_missing).toBe(false);
  });
});

describe('outbox-pending carries the gap for the QC ping', () => {
  it('created ping for a gap client says who was asked', async () => {
    const clientId = await makeClient('Ping Roasters');
    const sampleId = await makeBulk('Ping Roasters', clientId);
    await auth(request(app).post(`/clients/${clientId}/detail-requests`))
      .send({ missing: ['full street address'], asked_name: 'Tommie', asked_email: 't@sucafina.com', via: 'teams', note: 'lab has it' });
    const res = await auth(request(app).get('/notifications/outbox-pending'));
    const item = res.body.items.find((i: { sample_id: string; event: string }) => i.sample_id === sampleId && i.event === 'created');
    expect(item).toBeTruthy();
    expect(item.client_address_missing).toBe(true);
    expect(item.details_requested_from).toBe('Tommie');
    expect(item.details_requested_via).toBe('teams');
    expect(item.details_note).toBe('lab has it');
  });
});
