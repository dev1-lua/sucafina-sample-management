import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';

// Round 11 §3: the Clients view — one row per client with every coffee sent to them. Specialty + Commercial.

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

type Row = Record<string, unknown> & { key: string; client_name: string };
const byName = (rows: Row[], name: string) => rows.find((r) => r.client_name === name)!;

describe('GET /client-sends', () => {
  let torchId: string;
  let torchSends: { id: string; send_id: string }[] = [];
  beforeAll(async () => {
    const torch = await auth(request(app).post('/clients')).send({ name: 'Torch Coffee' });
    torchId = torch.body.id;
    const post = (body: Record<string, unknown>) => auth(request(app).post('/specialty-samples')).send(body);
    // Torch (by id): three sends of two coffees, one delivered awaiting result, one approved, one open.
    const t1 = await post({ ref: 'SL-9600', description: 'Nyeri AA', receiver_company: 'Torch Coffee', client_id: torchId, outturn: '15/9600', grade: 'AA', date: '2026-03-01' });
    const t2 = await post({ ref: 'SL-9600', description: 'Nyeri AA', receiver_company: 'Torch Coffee', client_id: torchId, outturn: '15/9600', grade: 'AA', date: '2026-03-05' });
    const t3 = await post({ ref: 'SL-9601', description: 'Kiambu AB', receiver_company: 'Torch Coffee', client_id: torchId, outturn: '15/9601', grade: 'AB', date: '2026-03-09' });
    torchSends = [t1.body, t2.body, t3.body];
    await auth(request(app).patch(`/specialty-samples/${t1.body.id}`)).send({ status: 'delivered' });
    await auth(request(app).patch(`/specialty-samples/${t2.body.id}`)).send({ status: 'delivered', result_norm: 'approved' });
    await auth(request(app).patch(`/specialty-samples/${t3.body.id}`)).send({ status: 'dispatched', courier_norm: 'dhl', awb: 'AWB-9601' });
    // Beyers (by name only, two spellings of the same name — the newest send's spelling is shown): two sends, one rejected.
    const b1 = await post({ ref: 'SL-9610', description: 'Kirinyaga AB', receiver_company: 'Beyers', date: '2026-02-10' });
    await post({ ref: 'SL-9611', description: 'Embu PB', receiver_company: '  beyers ', date: '2026-02-01' });
    await auth(request(app).patch(`/specialty-samples/${b1.body.id}`)).send({ status: 'delivered', result_norm: 'rejected' });
    // Commercial: Paulig by name — must not appear under the specialty book.
    await auth(request(app).post('/bulk-samples')).send({ sample_ref: 'TYPE-9620', quality: 'AB FAQ', client: 'Paulig', date: '2026-04-01' });
    await auth(request(app).post('/bulk-samples')).send({ sample_ref: 'TYPE-9620', quality: 'AB FAQ', client: 'Paulig', date: '2026-04-02' });
    // A deleted send never counts.
    const gone = await post({ ref: 'SL-9699', description: 'Gone', receiver_company: 'Torch Coffee', client_id: torchId });
    await auth(request(app).delete(`/specialty-samples/${gone.body.id}`));
  });

  it('groups by client_id when set, else by the receiver text (case/whitespace-insensitive), with the counts', async () => {
    const res = await auth(request(app).get('/client-sends?book=specialty'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 25 });
    const torch = byName(res.body.data, 'Torch Coffee');
    expect(torch).toMatchObject({
      key: `id:${torchId}`, client_id: torchId, sends: 3, coffees: 2,
      open_sends: 0, in_transit: 1, delivered_sends: 2, awaiting_results: 1, approved: 1, rejected: 0,
      last_send_on: '2026-03-09', last_ref: 'SL-9601', status_rollup: '2 delivered · 1 dispatched',
    });
    const beyers = byName(res.body.data, 'Beyers');
    expect(beyers).toMatchObject({
      key: 'name:beyers', client_id: null, sends: 2, coffees: 2,
      open_sends: 1, in_transit: 0, delivered_sends: 1, awaiting_results: 0, approved: 0, rejected: 1,
      last_send_on: '2026-02-10', last_ref: 'SL-9610', status_rollup: '1 delivered · 1 pending',
    });
    // Default sort: last_send_on desc.
    expect(res.body.data.map((r: Row) => r.client_name)).toEqual(['Torch Coffee', 'Beyers']);
  });

  it('book=commercial reads the bulk rows; an invalid / missing book is a 400', async () => {
    const res = await auth(request(app).get('/client-sends?book=commercial'));
    expect(res.body.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({ key: 'name:paulig', client_name: 'Paulig', sends: 2, coffees: 1, open_sends: 2, status_rollup: '2 pending' });
    expect((await auth(request(app).get('/client-sends'))).status).toBe(400);
    expect((await auth(request(app).get('/client-sends?book=forwarding'))).status).toBe(400);
  });

  it('q matches the client name, a ref or a send id', async () => {
    expect((await auth(request(app).get('/client-sends?book=specialty&q=torch'))).body.data.map((r: Row) => r.client_name)).toEqual(['Torch Coffee']);
    expect((await auth(request(app).get('/client-sends?book=specialty&q=SL-9611'))).body.data.map((r: Row) => r.client_name)).toEqual(['Beyers']);
    expect((await auth(request(app).get(`/client-sends?book=specialty&q=${torchSends[2].send_id}`))).body.data.map((r: Row) => r.client_name)).toEqual(['Torch Coffee']);
    expect((await auth(request(app).get('/client-sends?book=specialty&q=nobody'))).body).toMatchObject({ data: [], total: 0 });
  });

  it('sorts on the whitelist and pages', async () => {
    const byNameAsc = await auth(request(app).get('/client-sends?book=specialty&sort=client_name'));
    expect(byNameAsc.body.data.map((r: Row) => r.client_name)).toEqual(['Beyers', 'Torch Coffee']);
    const bySends = await auth(request(app).get('/client-sends?book=specialty&sort=sends'));
    expect(bySends.body.data.map((r: Row) => r.sends)).toEqual([3, 2]);
    const bogus = await auth(request(app).get('/client-sends?book=specialty&sort=drop_table'));
    expect(bogus.status).toBe(200);
    const p2 = await auth(request(app).get('/client-sends?book=specialty&pageSize=1&page=2&sort=client_name'));
    expect(p2.body).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(p2.body.data.map((r: Row) => r.client_name)).toEqual(['Torch Coffee']);
  });

  it('client= filters EXACTLY on the client name (case/whitespace-insensitive), independent of the fuzzy q', async () => {
    const roasters = await auth(request(app).post('/clients')).send({ name: 'Torch Roasters' });
    await auth(request(app).post('/specialty-samples')).send({ ref: 'SL-9630', description: 'Meru AA', receiver_company: 'Torch Roasters', client_id: roasters.body.id, date: '2026-05-01' });
    const names = async (qs: string) => (await auth(request(app).get(`/client-sends?book=specialty&${qs}`))).body.data.map((r: Row) => r.client_name).sort();
    expect(await names('q=torch')).toEqual(['Torch Coffee', 'Torch Roasters']);
    expect(await names(`client=${encodeURIComponent('Torch Coffee')}`)).toEqual(['Torch Coffee']);
    expect(await names(`client=${encodeURIComponent('  torch coffee ')}`)).toEqual(['Torch Coffee']);
    expect(await names(`client=${encodeURIComponent('Torch')}`)).toEqual([]);
    // Both together: q narrows within the exact client.
    expect(await names(`client=${encodeURIComponent('Torch Roasters')}&q=SL-9630`)).toEqual(['Torch Roasters']);
    expect(await names(`client=${encodeURIComponent('Torch Roasters')}&q=SL-9600`)).toEqual([]);
    const one = await auth(request(app).get(`/client-sends?book=specialty&client=${encodeURIComponent('Torch Coffee')}`));
    expect(one.body).toMatchObject({ total: 1 });
    expect(one.body.data[0]).toMatchObject({ key: `id:${torchId}`, sends: 3 });
  });

  it('rows with neither client_id nor receiver group under "(no client)"', async () => {
    await auth(request(app).post('/bulk-samples')).send({ quality: 'AA FAQ', client: '   ' });
    const res = await auth(request(app).get('/client-sends?book=commercial'));
    const none = byName(res.body.data, '(no client)');
    expect(none).toMatchObject({ key: 'name:(no client)', client_id: null, sends: 1 });
  });

  describe('GET /client-sends/:key', () => {
    it('returns the client and its sends, newest first, with send_id / ref / option_letter / lot_sends', async () => {
      const res = await auth(request(app).get(`/client-sends/${encodeURIComponent(`id:${torchId}`)}?book=specialty`));
      expect(res.status).toBe(200);
      expect(res.body.client).toEqual({ key: `id:${torchId}`, client_id: torchId, client_name: 'Torch Coffee' });
      expect(res.body.sends.map((s: { ref: string }) => s.ref)).toEqual(['SL-9601', 'SL-9600', 'SL-9600']);
      expect(res.body.sends[0]).toMatchObject({
        tab: 'specialty', id: torchSends[2].id, send_id: torchSends[2].send_id, ref: 'SL-9601', option_letter: null,
        title: 'Kiambu AB', date_on: '2026-03-09', status: 'dispatched', courier_norm: 'dhl', awb: 'AWB-9601',
        result_norm: null, consignment_number: null, lot_sends: 1,
      });
      expect(res.body.sends[1]).toMatchObject({ ref: 'SL-9600', lot_sends: 2, result_norm: 'approved', status: 'results_in' });
      expect(Object.keys(res.body.sends[0]).sort()).toEqual(
        ['awb', 'consignment_number', 'courier_norm', 'date_on', 'id', 'lot_sends', 'option_letter', 'qty_grams', 'ref', 'result_norm', 'send_id', 'status', 'tab', 'title'],
      );
    });

    it('a name key opens the text-grouped client; the other book is empty for it', async () => {
      const res = await auth(request(app).get('/client-sends/name%3Abeyers?book=specialty'));
      expect(res.status).toBe(200);
      expect(res.body.client).toEqual({ key: 'name:beyers', client_id: null, client_name: expect.stringMatching(/beyers/i) });
      expect(res.body.sends).toHaveLength(2);
      expect((await auth(request(app).get('/client-sends/name%3Abeyers?book=commercial'))).status).toBe(404);
    });

    it('a client on file with no sends in the book is an empty list; a bad key is a 400', async () => {
      const res = await auth(request(app).get(`/client-sends/${encodeURIComponent(`id:${torchId}`)}?book=commercial`));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ client: { key: `id:${torchId}`, client_id: torchId, client_name: 'Torch Coffee' }, sends: [] });
      expect((await auth(request(app).get('/client-sends/torch?book=specialty'))).status).toBe(400);
      expect((await auth(request(app).get('/client-sends/id%3Anot-a-uuid?book=specialty'))).status).toBe(400);
    });
  });
});
