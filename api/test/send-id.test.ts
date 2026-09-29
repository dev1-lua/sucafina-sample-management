import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, reapplyMigrationsFrom, API_KEY } from './helpers.js';
import { drawPss } from '../src/lib/contracts.js';
import { isSendId, liveSends } from '../src/lib/lots.js';
import { memberRows } from '../src/lib/consignments.js';

// Round 11 §1: every send carries its own immutable Send ID (SS-<n>), minted by the DB on insert. The ref
// names the coffee and is shared by every send of it; the send id is unique to the row.

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

const SS = /^SS-\d+$/;
const num = (id: string) => Number(id.slice(3));

describe('send_id is minted on every insert path', () => {
  it('create responses of all three books carry a sequential SS-<n>, whatever the ref', async () => {
    const before = (await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'SS'`)).rows[0].next_val as number;
    const sp = await auth(request(app).post('/specialty-samples')).send({ ref: 'SL-9101', description: 'Kirinyaga AB', receiver_company: 'Torch', outturn: '15/5670', grade: 'AB' });
    const bk = await auth(request(app).post('/bulk-samples')).send({ quality: 'Kirinyaga AB', client: 'Torch' });
    const fw = await auth(request(app).post('/forwarding-samples')).send({ sender: 'Nairobi', origin: 'Kenya', sample_ref: 'FW-1', coffee_quality: 'AB', receiver_company: 'Torch' });
    expect(sp.status).toBe(201);
    expect(bk.status).toBe(201);
    expect(fw.status).toBe(201);
    expect(sp.body.send_id).toMatch(SS);
    expect(bk.body.send_id).toMatch(SS);
    expect(fw.body.send_id).toMatch(SS);
    // One counter across the tables: consecutive numbers in insert order.
    expect(num(sp.body.send_id)).toBe(before);
    expect(num(bk.body.send_id)).toBe(before + 1);
    expect(num(fw.body.send_id)).toBe(before + 2);
    // Two sends of one coffee share the ref but never the send id.
    const again = await auth(request(app).post('/specialty-samples')).send({ ref: 'SL-9101', description: 'Kirinyaga AB', receiver_company: 'Beyers', outturn: '15/5670', grade: 'AB' });
    expect(again.status).toBe(201);
    expect(again.body.ref).toBe(sp.body.ref);
    expect(again.body.send_id).toBe(`SS-${before + 3}`);
  });

  it('a raw INSERT (importer / seed / scripts) gets one too; a typed send_id is kept', async () => {
    const { rows } = await pool.query(
      `INSERT INTO specialty_samples (ref, description, receiver_company, status) VALUES ('SL-9102', 'raw', 'Raw Co', 'requested') RETURNING send_id`,
    );
    expect(rows[0].send_id).toMatch(SS);
  });

  it('drawPss returns the send id of the option it drew', async () => {
    const c = await auth(request(app).post('/contracts')).send({ contract_number: 'SSKE-771001', client_name: 'Zoegas', quality: 'AA FAQ', pss_expected: 1, shipment_date: '2027-02-15' });
    expect(c.status).toBe(201);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const drawn = await drawPss(client, { contractId: c.body.id, containerNo: 1, actor: 'test' });
      await client.query('COMMIT');
      expect(drawn.sample_ref).toBe('SSKE-771001A');
      expect(drawn.send_id).toMatch(SS);
      const { rows } = await pool.query(`SELECT send_id FROM bulk_samples WHERE id = $1`, [drawn.id]);
      expect(rows[0].send_id).toBe(drawn.send_id);
    } finally {
      client.release();
    }
  });

  it('is immutable: an UPDATE cannot change it and a PATCH does not accept it', async () => {
    const sp = await auth(request(app).post('/specialty-samples')).send({ description: 'Immutable', receiver_company: 'Torch' });
    const id = sp.body.send_id as string;
    await pool.query(`UPDATE specialty_samples SET send_id = 'SS-1' WHERE id = $1`, [sp.body.id]);
    expect((await pool.query(`SELECT send_id FROM specialty_samples WHERE id = $1`, [sp.body.id])).rows[0].send_id).toBe(id);
    const p = await auth(request(app).patch(`/specialty-samples/${sp.body.id}`)).send({ send_id: 'SS-2', comments: 'x' });
    expect(p.status).toBe(200);
    expect(p.body.send_id).toBe(id);
  });

  it('is never released on delete (the counter does not step back)', async () => {
    const sp = await auth(request(app).post('/specialty-samples')).send({ description: 'Deleted', receiver_company: 'Torch' });
    const before = (await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'SS'`)).rows[0].next_val;
    await auth(request(app).delete(`/specialty-samples/${sp.body.id}`));
    expect((await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'SS'`)).rows[0].next_val).toBe(before);
    expect((await pool.query(`SELECT send_id FROM specialty_samples WHERE id = $1`, [sp.body.id])).rows[0].send_id).toBe(sp.body.send_id);
  });
});

describe('send_id is readable everywhere a row is shown', () => {
  let spId: string;
  let sendId: string;
  beforeAll(async () => {
    const sp = await auth(request(app).post('/specialty-samples')).send({ ref: 'SL-9200', description: 'Nyeri AA', receiver_company: 'Beyers', outturn: '15/9200', grade: 'AA' });
    spId = sp.body.id;
    sendId = sp.body.send_id;
    // A second send of the same coffee: the ref matches two rows, the send id exactly one.
    await auth(request(app).post('/specialty-samples')).send({ ref: 'SL-9200', description: 'Nyeri AA', receiver_company: 'Torch', outturn: '15/9200', grade: 'AA' });
  });

  it('GET /:id, the list and the view expose it', async () => {
    const g = await auth(request(app).get(`/specialty-samples/${spId}`));
    expect(g.body.send_id).toBe(sendId);
    const list = await auth(request(app).get(`/specialty-samples?q=${sendId}`));
    expect(list.body.total).toBe(1);
    expect(list.body.data[0].id).toBe(spId);
    const v = await pool.query(`SELECT send_id, option_letter FROM all_samples_v WHERE id = $1`, [spId]);
    expect(v.rows[0]).toEqual({ send_id: sendId, option_letter: null });
  });

  it('?ref=SS-<n> on the book list and /search picks that one row; ?ref=<ref> keeps every send of the coffee', async () => {
    const byRef = await auth(request(app).get('/specialty-samples?ref=SL-9200'));
    expect(byRef.body.total).toBe(2);
    const byId = await auth(request(app).get(`/specialty-samples?ref=${sendId.toLowerCase()}`));
    expect(byId.body.total).toBe(1);
    expect(byId.body.data[0].id).toBe(spId);
    const s = await auth(request(app).get(`/search?ref=${sendId}`));
    expect(s.body.total).toBe(1);
    expect(s.body.data[0]).toMatchObject({ id: spId, send_id: sendId, ref: 'SL-9200' });
  });

  it('/search?q=SS-<n> finds it', async () => {
    const s = await auth(request(app).get(`/search?q=${sendId}`));
    expect(s.body.total).toBe(1);
    expect(s.body.data[0]).toMatchObject({ tab: 'specialty', id: spId, send_id: sendId });
  });

  it('/samples/resolve?ref=SS-<n> returns exactly that row (a ref returns every send)', async () => {
    const byId = await auth(request(app).get(`/samples/resolve?ref=${sendId}`));
    expect(byId.status).toBe(200);
    expect(byId.body.candidates).toHaveLength(1);
    expect(byId.body.candidates[0]).toMatchObject({ tab: 'specialty', id: spId, send_id: sendId, ref: 'SL-9200' });
    const byRef = await auth(request(app).get('/samples/resolve?ref=sl 9200'));
    expect(byRef.body.candidates).toHaveLength(2);
    expect(byRef.body.candidates.every((c: { send_id: string }) => SS.test(c.send_id))).toBe(true);
  });

  it('lot sends, order members, the client record and the chaser digest carry it', async () => {
    const sends = await liveSends(pool, 'SL-9200', { limit: 10 });
    // Two sends of one coffee: both carry a send id and they differ.
    expect(sends).toHaveLength(2);
    expect(sends.every((s) => SS.test(String(s.send_id)))).toBe(true);
    expect(new Set(sends.map((s) => s.send_id)).size).toBe(2);
    expect(sends.find((s) => s.id === spId)?.send_id).toBe(sendId);
    const lot = await auth(request(app).get('/lots/SL-9200'));
    expect(lot.body.sends.find((s: { id: string }) => s.id === spId).send_id).toBe(sendId);
    // /lots?q=SS-<n> returns the coffee that owns the send (the Coffees view chip reads "Ref or Send ID").
    const lotsByRow = await auth(request(app).get(`/lots?q=${sendId.toLowerCase()}`));
    expect(lotsByRow.body.total).toBe(1);
    expect(lotsByRow.body.data[0]).toMatchObject({ ref: 'SL-9200', sends: 2 });
    // The q goes through normalize_ref, so "ss 1234" / " ss - 1234 " find it too.
    const spaced = await auth(request(app).get(`/lots?q=${encodeURIComponent(`ss ${sendId.slice(3)}`)}`));
    expect(spaced.body.total).toBe(1);
    expect(spaced.body.data[0]).toMatchObject({ ref: 'SL-9200' });
    expect((await auth(request(app).get(`/lots?q=${encodeURIComponent(` ss - ${sendId.slice(3)} `)}`))).body.total).toBe(1);
    expect((await auth(request(app).get('/lots?q=SS-1'))).body.total).toBe(0);

    const cl = await auth(request(app).post('/clients')).send({ name: 'Send Id Client' });
    const sp = await auth(request(app).post('/specialty-samples')).send({ description: 'Client row', receiver_company: 'Send Id Client', client_id: cl.body.id });
    const cn = await auth(request(app).post('/consignments')).send({ client_id: cl.body.id });
    expect(cn.status).toBe(201);
    const add = await auth(request(app).post(`/consignments/${cn.body.id}/samples`)).send({ tab: 'specialty', ids: [sp.body.id] });
    expect(add.status).toBe(200);
    const members = await memberRows(pool, cn.body.id);
    expect(members).toHaveLength(1);
    expect(members[0].send_id).toBe(sp.body.send_id);
    const c = await auth(request(app).get(`/clients/${cl.body.id}`));
    expect(c.body.orders[0].send_id).toBe(sp.body.send_id);
    const cnGet = await auth(request(app).get(`/consignments/${cn.body.id}`));
    expect(cnGet.body.members[0].send_id).toBe(sp.body.send_id);
  });

  it('isSendId only accepts the SS-<digits> shape', () => {
    expect(isSendId('SS-1001')).toBe(true);
    expect(isSendId('SSKE-104929A')).toBe(false);
    expect(isSendId('SL-7336')).toBe(false);
    expect(isSendId('SS-')).toBe(false);
  });
});

describe('migration 025 is idempotent', () => {
  it('re-applying from 025 (as deploy-api.sh does) changes no send id, mints none, leaves no duplicates', async () => {
    const snapshot = async () => (await pool.query(
      `SELECT tab, id, send_id FROM all_samples_v ORDER BY send_id`,
    )).rows as { tab: string; id: string; send_id: string }[];
    const before = await snapshot();
    const counterBefore = (await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'SS'`)).rows[0].next_val;
    expect(before.length).toBeGreaterThan(5);
    expect(before.every((r) => SS.test(r.send_id))).toBe(true);

    const files = await reapplyMigrationsFrom('025');
    expect(files[0]).toBe('025_send_id_and_view.sql');

    expect(await snapshot()).toEqual(before);
    expect((await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'SS'`)).rows[0].next_val).toBe(counterBefore);
    const dup = await pool.query(
      `SELECT send_id, count(*)::int AS n FROM (
         SELECT send_id FROM specialty_samples UNION ALL SELECT send_id FROM bulk_samples UNION ALL SELECT send_id FROM forwarding_samples
       ) x GROUP BY send_id HAVING count(*) > 1`,
    );
    expect(dup.rows).toEqual([]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM specialty_samples WHERE send_id IS NULL`)).rows[0].n).toBe(0);
    // The view still ends in send_id, option_letter and every column before them is where 024 left it.
    const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'all_samples_v' ORDER BY ordinal_position`)).rows.map((r) => r.column_name);
    expect(cols.slice(-3)).toEqual(['consignment_number', 'send_id', 'option_letter']);
  });

  it('backfills rows that pre-date the column chronologically across the three tables, from a reserved block', async () => {
    // Simulate pre-025 rows: bypass the immutability trigger by dropping the send ids at the SQL level.
    const ids = { sp: [] as string[], bk: [] as string[], fw: [] as string[] };
    for (const [i, d] of ['2026-01-03', '2026-01-01'].entries()) {
      const sp = await auth(request(app).post('/specialty-samples')).send({ description: `bf ${i}`, receiver_company: 'Backfill Co', date: d });
      ids.sp.push(sp.body.id);
    }
    const bk = await auth(request(app).post('/bulk-samples')).send({ quality: 'bf', client: 'Backfill Co', date: '2026-01-02' });
    ids.bk.push(bk.body.id);
    const fw = await auth(request(app).post('/forwarding-samples')).send({ sender: 'x', origin: 'Kenya', sample_ref: 'FW-bf', coffee_quality: 'bf', receiver_company: 'Backfill Co', date: '2026-01-04' });
    ids.fw.push(fw.body.id);
    // A deleted row is backfilled too (the number is never reused).
    await auth(request(app).delete(`/forwarding-samples/${fw.body.id}`));

    await pool.query(`ALTER TABLE specialty_samples DISABLE TRIGGER specialty_send_id_upd`);
    await pool.query(`ALTER TABLE bulk_samples DISABLE TRIGGER bulk_send_id_upd`);
    await pool.query(`ALTER TABLE forwarding_samples DISABLE TRIGGER forwarding_send_id_upd`);
    await pool.query(`UPDATE specialty_samples SET send_id = NULL WHERE id = ANY($1::uuid[])`, [ids.sp]);
    await pool.query(`UPDATE bulk_samples SET send_id = NULL WHERE id = ANY($1::uuid[])`, [ids.bk]);
    await pool.query(`UPDATE forwarding_samples SET send_id = NULL WHERE id = ANY($1::uuid[])`, [ids.fw]);
    await pool.query(`ALTER TABLE specialty_samples ENABLE TRIGGER specialty_send_id_upd`);
    await pool.query(`ALTER TABLE bulk_samples ENABLE TRIGGER bulk_send_id_upd`);
    await pool.query(`ALTER TABLE forwarding_samples ENABLE TRIGGER forwarding_send_id_upd`);
    const counterBefore = (await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'SS'`)).rows[0].next_val as number;

    await reapplyMigrationsFrom('025');

    const { rows } = await pool.query(
      `SELECT tab, id, send_id, date_on::text AS date_on FROM all_samples_v WHERE id = ANY($1::uuid[]) ORDER BY date_on`,
      [[...ids.sp, ...ids.bk, ...ids.fw]],
    );
    // Oldest date first: 01-01 (specialty) → 01-02 (bulk) → 01-03 (specialty) → 01-04 (forwarding, deleted).
    expect(rows.map((r) => [r.tab, r.date_on])).toEqual([
      ['specialty', '2026-01-01'], ['bulk', '2026-01-02'], ['specialty', '2026-01-03'], ['forwarding', '2026-01-04'],
    ]);
    expect(rows.map((r) => num(r.send_id))).toEqual([counterBefore, counterBefore + 1, counterBefore + 2, counterBefore + 3]);
    expect((await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'SS'`)).rows[0].next_val).toBe(counterBefore + 4);
  });
});
