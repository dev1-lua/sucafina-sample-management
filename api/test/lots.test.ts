import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, reapplyMigrationsFrom, API_KEY } from './helpers.js';
import { normalizeRef, normalizeQuality, coffeeKeyFor, resolveLot, findLot, claimRef, liveSends } from '../src/lib/lots.js';
import { LOT_CONFLICTS_ACTOR, applyLotConflicts, listLotConflicts } from '../src/lib/lot-conflicts.js';

// Round 10 (A1): a ref names the COFFEE, not the send. The same ref is reused when the same coffee goes
// out again (SL-7336 → 3 receivers); different coffee must never share a ref (the TYPE-113 bug).

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('normalizeRef', () => {
  it('upper-cases, trims and collapses the prefix/number separator to one dash', () => {
    expect(normalizeRef('type - 980')).toBe('TYPE-980');
    expect(normalizeRef('  sl 7336 ')).toBe('SL-7336');
    expect(normalizeRef('SSKE-104929D')).toBe('SSKE-104929D');
    expect(normalizeRef('Kiri/Kirinyaga')).toBe('KIRI/KIRINYAGA');
    expect(normalizeRef('KIRI/KIRINYAGA')).toBe(normalizeRef('Kiri/Kirinyaga'));
    expect(normalizeRef('CUSTOM-1')).toBe('CUSTOM-1');
  });
});

describe('normalizeQuality', () => {
  it('lower-cases, strips punctuation and the sample/replacement noise words', () => {
    expect(normalizeQuality('AB FAQ')).toBe('ab faq');
    expect(normalizeQuality('  AB  faq. ')).toBe('ab faq');
    expect(normalizeQuality('AB FAQ (replacement)')).toBe('ab faq');
    expect(normalizeQuality('AB FAQ sample')).toBe('ab faq');
    expect(normalizeQuality('Kenya AB samples')).toBe('kenya ab');
  });
  it('keeps the distinguishing letter: "TYPE SAMPLE B" ≠ "ARABICA SAMPLE B"', () => {
    expect(normalizeQuality('TYPE SAMPLE B')).toBe('b');
    expect(normalizeQuality('ARABICA SAMPLE B')).toBe('arabica b');
    expect(normalizeQuality('TYPE SAMPLE B')).not.toBe(normalizeQuality('ARABICA SAMPLE B'));
  });
  it('blends are order-insensitive: split on , or /, sorted, re-joined with " / "', () => {
    expect(normalizeQuality('AA PLUS 30% / AB 70%')).toBe('aa plus 30% / ab 70%');
    expect(normalizeQuality('AB 70%, AA PLUS 30%')).toBe('aa plus 30% / ab 70%');
    expect(normalizeQuality('AA PLUS (30%), AB (70%)')).toBe('aa plus 30% / ab 70%');
    expect(normalizeQuality('')).toBe('');
    expect(normalizeQuality(null)).toBe('');
  });
});

describe('coffeeKeyFor', () => {
  it('specialty = outturn|grade, falling back to normalised description|grade', () => {
    expect(coffeeKeyFor({ book: 'specialty', outturn: ' 15/5670 ', grade: 'aa', quality: 'Nyeri AA' })).toBe('15/5670|AA');
    expect(coffeeKeyFor({ book: 'specialty', outturn: '', grade: 'AB', quality: 'Kiri / Kirinyaga' })).toBe('kiri / kirinyaga|AB');
    expect(coffeeKeyFor({ book: 'specialty', outturn: null, grade: null, quality: 'Nyeri AA' })).toBe('nyeri aa|');
  });
  it('commercial = normalised quality|normalised blend', () => {
    expect(coffeeKeyFor({ book: 'commercial', quality: 'AB FAQ', blend: null })).toBe('ab faq|');
    expect(coffeeKeyFor({ book: 'commercial', quality: 'Blend', blend: 'AB 70%, AA PLUS 30%' })).toBe('blend|aa plus 30% / ab 70%');
  });
  it('agrees with the SQL coffee_key()/normalize_ref() used by the backfill and the view', async () => {
    const cases: Array<{ book: 'specialty' | 'commercial'; outturn?: string | null; grade?: string | null; quality?: string | null; blend?: string | null }> = [
      { book: 'specialty', outturn: ' 15/5670 ', grade: 'aa', quality: 'Nyeri AA' },
      { book: 'specialty', outturn: null, grade: 'AB', quality: 'Kiri / Kirinyaga (replacement)' },
      { book: 'specialty', outturn: '', grade: null, quality: 'TYPE SAMPLE B' },
      { book: 'commercial', quality: 'AA PLUS (30%), AB (70%)', blend: 'AB 70%, AA PLUS 30%' },
      { book: 'commercial', quality: 'ARABICA SAMPLE B', blend: null },
      { book: 'commercial', quality: 'Kenya AB samples.', blend: '' },
    ];
    for (const c of cases) {
      const { rows } = await pool.query(`SELECT coffee_key($1, $2, $3, $4, $5) AS k`, [c.book, c.outturn ?? null, c.grade ?? null, c.quality ?? null, c.blend ?? null]);
      expect(rows[0].k, JSON.stringify(c)).toBe(coffeeKeyFor(c));
    }
    for (const r of ['type - 980', '  sl 7336 ', 'Kiri/Kirinyaga', 'SSKE-104929D']) {
      const { rows } = await pool.query(`SELECT normalize_ref($1) AS r`, [r]);
      expect(rows[0].r).toBe(normalizeRef(r));
    }
  });
});

describe('claimRef', () => {
  it('moves the counter past a typed number, never backwards', async () => {
    const before = (await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'TYPE'`)).rows[0].next_val as number;
    expect(await claimRef(pool, `TYPE-${before + 40}`)).toBe(true);
    expect((await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'TYPE'`)).rows[0].next_val).toBe(before + 41);
    expect(await claimRef(pool, 'TYPE-5')).toBe(true);
    expect((await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'TYPE'`)).rows[0].next_val).toBe(before + 41);
    expect(await claimRef(pool, 'CUSTOM-1')).toBe(false);
  });
});

describe('resolveLot (pure read)', () => {
  let bulkA: string;
  beforeAll(async () => {
    const a = await auth(request(app).post('/bulk-samples')).send({ quality: 'AB FAQ', client: 'Joh Johanson', sample_type: 'type', sample_ref: 'TYPE-113', qty_grams: 300, courier_norm: 'dhl' });
    bulkA = a.body.id;
    await auth(request(app).post('/specialty-samples')).send({ description: 'Nyeri AA', receiver_company: 'Sucafina NV', outturn: '15/5670', grade: 'AA', ref: 'SL-7336' });
  });

  it('typed ref + same coffee → reuse', async () => {
    const r = await resolveLot(pool, { book: 'commercial', ref: 'type - 113', quality: 'ab faq', blend: null });
    expect(r.action).toBe('reuse');
    expect(r.ref).toBe('TYPE-113');
    expect(r.lot).toMatchObject({ ref: 'TYPE-113', book: 'commercial', quality: 'AB FAQ' });
    expect(r.sends).toHaveLength(1);
    expect(r.sends[0]).toMatchObject({ tab: 'bulk', id: bulkA, receiver: 'Joh Johanson', status: 'requested', qty_grams: 300, courier_norm: 'dhl', awb: null });
    expect(typeof r.sends[0].date_on).toBe('string');
    expect(r.reason).toEqual(expect.any(String));
  });

  it('typed ref + different coffee → conflict with the existing lot and its sends', async () => {
    const r = await resolveLot(pool, { book: 'commercial', ref: 'TYPE-113', quality: 'AA FAQ', blend: null });
    expect(r.action).toBe('conflict');
    expect(r.ref).toBe('TYPE-113');
    expect(r.lot?.coffee_key).toBe('ab faq|');
    expect(r.sends.map((s) => s.id)).toEqual([bulkA]);
  });

  it('typed ref + no lot → new (ref = typed)', async () => {
    const r = await resolveLot(pool, { book: 'commercial', ref: 'TYPE-999', quality: 'AB FAQ', blend: null });
    expect(r).toMatchObject({ action: 'new', ref: 'TYPE-999', lot: null, sends: [] });
  });

  it('no ref + a lot with this coffee in this book → reuse (ref = the lot\'s)', async () => {
    const r = await resolveLot(pool, { book: 'specialty', outturn: '15/5670', grade: 'aa', quality: 'whatever' });
    expect(r.action).toBe('reuse');
    expect(r.ref).toBe('SL-7336');
    expect(r.sends[0]).toMatchObject({ tab: 'specialty', receiver: 'Sucafina NV' });
    // The other book does not see it.
    const other = await resolveLot(pool, { book: 'commercial', quality: 'Nyeri AA', blend: null });
    expect(other).toMatchObject({ action: 'new', ref: null, lot: null });
  });

  it('no ref + no lot → new, ref null', async () => {
    const r = await resolveLot(pool, { book: 'specialty', outturn: '99/0001', grade: 'PB', quality: 'x' });
    expect(r).toMatchObject({ action: 'new', ref: null, lot: null, sends: [] });
  });

  it('liveSends is newest first, live rows only, capped', async () => {
    const b = await auth(request(app).post('/bulk-samples')).send({ quality: 'AB FAQ', client: 'Paulig', sample_type: 'type', sample_ref: 'TYPE-113', date: '2030-01-01' });
    expect(b.status).toBe(201);
    const sends = await liveSends(pool, 'TYPE-113', { limit: 20 });
    expect(sends.map((s) => s.id)).toEqual([b.body.id, bulkA]);
    expect(await liveSends(pool, 'TYPE-113', { limit: 1 })).toHaveLength(1);
    await auth(request(app).delete(`/bulk-samples/${b.body.id}`));
    expect((await liveSends(pool, 'TYPE-113', { limit: 20 })).map((s) => s.id)).toEqual([bulkA]);
  });
});

describe('migration 023 backfill', () => {
  it('one lot per distinct live ref (oldest row is the coffee), shared refs with different receivers are NOT conflicts', async () => {
    // Legacy-shaped rows: same ref, same coffee, three receivers (SL-7336-style), written straight to the table.
    await pool.query(
      `INSERT INTO specialty_samples (ref, description, receiver_company, outturn, grade, status, created_at) VALUES
         ('SL-9001', 'Nyeri AA', 'Beyers',      '20/1000', 'AA', 'delivered', now() - interval '3 days'),
         ('SL-9001', 'Nyeri AA', 'Sucafina NV', '20/1000', 'AA', 'dispatched', now() - interval '2 days'),
         ('SL-9001', 'Nyeri AA', 'Paulig',      '20/1000', 'AA', 'requested', now() - interval '1 day')`);
    // TYPE-113-style rows: one ref, two qualities → the newer one is a conflict.
    await pool.query(
      `INSERT INTO bulk_samples (sample_ref, quality, client, sample_type_norm, status, created_at) VALUES
         ('TYPE-9113', 'AB FAQ', 'Joh Johanson', 'type', 'delivered', now() - interval '5 days'),
         ('TYPE-9113', 'AA FAQ', 'Nestrade',     'type', 'requested', now() - interval '4 days'),
         ('TYPE-9113', 'AB FAQ', 'Beyers',       'type', 'requested', now() - interval '3 days')`);
    // A deleted row never seeds a lot.
    await pool.query(
      `INSERT INTO bulk_samples (sample_ref, quality, client, status, deleted_at) VALUES ('TYPE-9999', 'Gone', 'X', 'requested', now())`);
    // Legacy rows whose ref is not written canonically still land on the canonical lot.
    await pool.query(
      `INSERT INTO bulk_samples (sample_ref, quality, client, status, created_at) VALUES ('type - 9113', 'AB FAQ', 'Late Roasters', 'requested', now())`);

    await reapplyMigrationsFrom('023');

    const sl = await findLot(pool, 'SL-9001');
    expect(sl).toMatchObject({ ref: 'SL-9001', book: 'specialty', coffee_key: '20/1000|AA', outturn: '20/1000', grade: 'AA', quality: 'Nyeri AA' });
    const ty = await findLot(pool, 'TYPE-9113');
    expect(ty).toMatchObject({ ref: 'TYPE-9113', book: 'commercial', coffee_key: 'ab faq|', quality: 'AB FAQ' });
    expect(await findLot(pool, 'TYPE-9999')).toBeNull();
    expect((await liveSends(pool, 'TYPE-9113', { limit: 20 })).map((s) => s.receiver)).toEqual(['Late Roasters', 'Beyers', 'Nestrade', 'Joh Johanson']);

    const { rows: conflicts } = await pool.query(`SELECT * FROM lot_conflicts ORDER BY ref`);
    expect(conflicts.filter((c) => c.ref === 'SL-9001')).toHaveLength(0);
    const tc = conflicts.filter((c) => c.ref === 'TYPE-9113');
    expect(tc).toHaveLength(1);
    expect(tc[0]).toMatchObject({ book: 'commercial', tab: 'bulk', coffee_key: 'aa faq|', quality: 'AA FAQ' });

    // Re-applying (every deploy does) changes nothing.
    await reapplyMigrationsFrom('023');
    expect((await pool.query(`SELECT count(*)::int AS n FROM lot_conflicts WHERE ref = 'TYPE-9113'`)).rows[0].n).toBe(1);
    expect((await pool.query(`SELECT count(*)::int AS n FROM lots WHERE ref IN ('SL-9001','TYPE-9113')`)).rows[0].n).toBe(2);
  });
});

describe('create routes: typed ref → lot + counter', () => {
  it('a typed free ref registers its lot and moves the counter past it, so the next auto-issue never collides', async () => {
    const before = (await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'SL'`)).rows[0].next_val as number;
    const typed = `SL-${before + 10}`;
    const res = await auth(request(app).post('/specialty-samples')).send({ description: 'Typed AA', receiver_company: 'Beyers', outturn: '30/2000', grade: 'AA', ref: ` sl - ${before + 10} ` });
    expect(res.status).toBe(201);
    expect(res.body.ref).toBe(typed);
    expect(res.body).toMatchObject({ lot_sends: 1, reused_ref: false });
    expect(await findLot(pool, typed)).toMatchObject({ book: 'specialty', coffee_key: '30/2000|AA', created_by: 'test' });
    expect((await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'SL'`)).rows[0].next_val).toBe(before + 11);
    const auto = await auth(request(app).post('/specialty-samples')).send({ description: 'Auto', receiver_company: 'Beyers' });
    expect(auto.body.ref).toBe(`SL-${before + 11}`);
    expect(await findLot(pool, auto.body.ref)).toMatchObject({ book: 'specialty', coffee_key: 'auto|' });
  });

  it('typed ref + same coffee → 201 with reused_ref: true and lot_sends: 2 (a re-send)', async () => {
    const first = await auth(request(app).post('/bulk-samples')).send({ quality: 'AB FAQ', client: 'Joh Johanson', sample_type: 'type', sample_ref: 'TYPE-973' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ lot_sends: 1, reused_ref: false });
    const again = await auth(request(app).post('/bulk-samples')).send({ quality: 'ab faq.', client: 'Joh Johanson', sample_type: 'type', sample_ref: 'type-973' });
    expect(again.status).toBe(201);
    expect(again.body.sample_ref).toBe('TYPE-973');
    expect(again.body).toMatchObject({ lot_sends: 2, reused_ref: true });
    expect((await auth(request(app).get(`/bulk-samples/${first.body.id}`))).body.lot_sends).toBe(2);
  });

  it('typed ref + different coffee → 409 ref_conflict with the lot and its sends; nothing written', async () => {
    const n = (await pool.query(`SELECT count(*)::int AS n FROM bulk_samples`)).rows[0].n;
    const res = await auth(request(app).post('/bulk-samples')).send({ quality: 'AA FAQ', client: 'Nestrade', sample_type: 'type', sample_ref: 'TYPE-973' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ref_conflict');
    expect(res.body.ref).toBe('TYPE-973');
    expect(res.body.lot).toMatchObject({ ref: 'TYPE-973', book: 'commercial', quality: 'AB FAQ' });
    expect(res.body.sends).toHaveLength(2);
    expect(res.body.sends[0]).toMatchObject({ tab: 'bulk', receiver: 'Joh Johanson' });
    expect((await pool.query(`SELECT count(*)::int AS n FROM bulk_samples`)).rows[0].n).toBe(n);
    // Specialty too.
    const sp = await auth(request(app).post('/specialty-samples')).send({ description: 'Other', receiver_company: 'X', outturn: '99/9999', grade: 'PB', ref: 'SL-7336' });
    expect(sp.status).toBe(409);
    expect(sp.body.lot.coffee_key).toBe('15/5670|AA');
  });

  it('no ref + an existing coffee: resolve says reuse, but a create without a ref still mints a new one (the agent decides)', async () => {
    const r = await auth(request(app).post('/lots/resolve')).send({ book: 'commercial', quality: 'AB FAQ', blend: null, sample_type: 'type' });
    expect(r.status).toBe(200);
    expect(r.body.action).toBe('reuse');
    const res = await auth(request(app).post('/bulk-samples')).send({ quality: 'AB FAQ', client: 'Beyers', sample_type: 'type' });
    expect(res.status).toBe(201);
    expect(res.body.sample_ref).toMatch(/^TYPE-\d+$/);
    expect(res.body.sample_ref).not.toBe(r.body.ref);
    expect(res.body).toMatchObject({ lot_sends: 1, reused_ref: false });
  });

  it('a PSS drawn from its contract number registers its contract-derived ref as a lot, never a conflict', async () => {
    const c = await auth(request(app).post('/contracts')).send({ contract_number: 'SSKE-555001', client_name: 'Paulig', quality: 'AB FAQ', pss_expected: 1, shipment_date: '2027-01-15' });
    expect(c.status).toBe(201);
    const pss = await auth(request(app).post('/bulk-samples')).send({ quality: 'AB FAQ', client: 'Paulig', sample_type: 'pss', contract_number: 'SSKE-555001' });
    expect(pss.status).toBe(201);
    expect(pss.body.sample_ref).toBe('SSKE-555001A');
    expect(await findLot(pool, 'SSKE-555001A')).toMatchObject({ book: 'commercial' });
  });

  it('deleting the last send removes the lot; deleting one of several keeps it', async () => {
    const a = await auth(request(app).post('/bulk-samples')).send({ quality: 'PB', client: 'A', sample_type: 'offer', sample_ref: 'CUSTOM-77' });
    const b = await auth(request(app).post('/bulk-samples')).send({ quality: 'PB', client: 'B', sample_type: 'offer', sample_ref: 'CUSTOM-77' });
    expect(b.body.lot_sends).toBe(2);
    await auth(request(app).delete(`/bulk-samples/${a.body.id}`));
    expect(await findLot(pool, 'CUSTOM-77')).not.toBeNull();
    await auth(request(app).delete(`/bulk-samples/${b.body.id}`));
    expect(await findLot(pool, 'CUSTOM-77')).toBeNull();
  });
});

describe('/lots routes', () => {
  it('POST /lots/resolve validates and returns the resolution', async () => {
    expect((await auth(request(app).post('/lots/resolve')).send({ book: 'nope' })).status).toBe(400);
    const r = await auth(request(app).post('/lots/resolve')).send({ book: 'specialty', ref: 'sl 7336', outturn: '15/5670', grade: 'AA', quality: 'Nyeri AA' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ action: 'reuse', ref: 'SL-7336' });
    expect(r.body.lot.ref).toBe('SL-7336');
    expect(Array.isArray(r.body.sends)).toBe(true);
  });

  it('GET /lots/:ref → lot + sends (with title and consignment_number); 404 when unknown', async () => {
    const r = await auth(request(app).get('/lots/type - 973'));
    expect(r.status).toBe(200);
    expect(r.body.lot).toMatchObject({ ref: 'TYPE-973', book: 'commercial' });
    expect(r.body.sends).toHaveLength(2);
    expect(r.body.sends[0]).toMatchObject({ tab: 'bulk', title: 'ab faq.', receiver: 'Joh Johanson', consignment_number: null });
    expect((await auth(request(app).get('/lots/NOPE-1'))).status).toBe(404);
  });

  it('GET /lots lists lots with send roll-ups; q matches a send\'s receiver; book filter', async () => {
    const all = await auth(request(app).get('/lots?pageSize=100'));
    expect(all.status).toBe(200);
    const t973 = all.body.data.find((l: { ref: string }) => l.ref === 'TYPE-973');
    expect(t973).toMatchObject({ book: 'commercial', sends: 2, open_sends: 2, delivered_sends: 0, last_receiver: 'Joh Johanson' });
    expect(t973.status_rollup).toBe('2 pending');
    expect(typeof t973.last_send_on).toBe('string');
    expect(all.body.total).toBeGreaterThanOrEqual(3);

    const byReceiver = await auth(request(app).get('/lots?q=johanson'));
    expect(byReceiver.body.data.map((l: { ref: string }) => l.ref)).toContain('TYPE-973');
    expect(byReceiver.body.data.map((l: { ref: string }) => l.ref)).not.toContain('SL-7336');

    const spec = await auth(request(app).get('/lots?book=specialty&pageSize=100'));
    expect(spec.body.data.every((l: { book: string }) => l.book === 'specialty')).toBe(true);
    expect(spec.body.data.map((l: { ref: string }) => l.ref)).toContain('SL-7336');
    expect((await auth(request(app).get('/lots?book=bogus'))).status).toBe(400);
  });
});

describe('GET /samples/resolve + list filters', () => {
  it('resolves a ref to its live candidates, newest first; receiver + tab filters; [] when unknown', async () => {
    const r = await auth(request(app).get('/samples/resolve?ref=type%20973'));
    expect(r.status).toBe(200);
    expect(r.body.ref).toBe('TYPE-973');
    expect(r.body.candidates).toHaveLength(2);
    expect(r.body.candidates[0]).toMatchObject({ tab: 'bulk', ref: 'TYPE-973', receiver: 'Joh Johanson', status: 'requested', consignment_number: null, awb: null });
    expect(Object.keys(r.body.candidates[0]).sort()).toEqual(['awb', 'consignment_number', 'courier_norm', 'date_on', 'id', 'receiver', 'ref', 'status', 'tab', 'title'].sort());
    const none = await auth(request(app).get('/samples/resolve?ref=TYPE-973&receiver=nestrade'));
    expect(none.body.candidates).toEqual([]);
    const spec = await auth(request(app).get('/samples/resolve?ref=TYPE-973&tab=specialty'));
    expect(spec.body.candidates).toEqual([]);
    expect((await auth(request(app).get('/samples/resolve?ref=NOPE-1'))).body).toEqual({ ref: 'NOPE-1', candidates: [] });
    expect((await auth(request(app).get('/samples/resolve'))).status).toBe(400);
  });

  it('book lists, GET /:id and /search carry lot_sends + consignment_number and take ?ref= / ?consignment=', async () => {
    const cn = await auth(request(app).post('/consignments')).send({ location: 'thika' });
    const bulk = await auth(request(app).get('/bulk-samples?ref=type%20973'));
    expect(bulk.body.total).toBe(2);
    expect(bulk.body.data[0]).toMatchObject({ lot_sends: 2, consignment_number: null });
    const id = bulk.body.data[0].id;
    await auth(request(app).post(`/consignments/${cn.body.id}/samples`)).send({ tab: 'bulk', ids: [id] });
    const byNumber = await auth(request(app).get(`/bulk-samples?consignment=${cn.body.number}`));
    expect(byNumber.body.data.map((r: { id: string }) => r.id)).toEqual([id]);
    expect(byNumber.body.data[0].consignment_number).toBe(cn.body.number);
    const byId = await auth(request(app).get(`/bulk-samples?consignment=${cn.body.id}`));
    expect(byId.body.total).toBe(1);
    const search = await auth(request(app).get(`/search?consignment=${cn.body.number}`));
    expect(search.body.data.map((r: { id: string }) => r.id)).toEqual([id]);
    expect(search.body.data[0]).toMatchObject({ lot_sends: 2, consignment_number: cn.body.number });
    expect((await auth(request(app).get('/search?ref=TYPE-973'))).body.total).toBe(2);
    expect((await auth(request(app).get('/specialty-samples?ref=sl-7336'))).body.total).toBe(1);
    expect((await auth(request(app).get('/forwarding-samples?ref=nothing'))).body.total).toBe(0);
  });
});

// A5: the rows migration 023 flagged (one ref, two coffees) are re-issued by scripts/lot-conflicts.ts.
describe('scripts/lot-conflicts (A5)', () => {
  let nestrade1: string;
  let nestrade2: string;

  it('dry run groups the conflicts by ref with the lot\'s coffee and each row\'s own; changes nothing', async () => {
    // A second AA FAQ send on TYPE-9113 (legacy-shaped): the two must end up SHARING one new ref.
    await pool.query(
      `INSERT INTO bulk_samples (sample_ref, quality, client, sample_type_norm, status, created_at) VALUES
         ('TYPE-9113', 'AA FAQ', 'Nestrade', 'type', 'requested', now() - interval '2 days'),
         ('TYPE-9113', 'PB', 'Gone Roasters', 'type', 'requested', now() - interval '1 day')`);
    await reapplyMigrationsFrom('023');
    // A flagged row deleted since detection is just dropped.
    await pool.query(`UPDATE bulk_samples SET deleted_at = now() WHERE sample_ref = 'TYPE-9113' AND client = 'Gone Roasters'`);
    const { rows } = await pool.query(`SELECT id FROM bulk_samples WHERE sample_ref = 'TYPE-9113' AND client = 'Nestrade' ORDER BY created_at`);
    [nestrade1, nestrade2] = rows.map((r) => String(r.id));

    const groups = await listLotConflicts(pool);
    const g = groups.find((x) => x.ref === 'TYPE-9113')!;
    expect(g.lot).toMatchObject({ ref: 'TYPE-9113', book: 'commercial', coffee_key: 'ab faq|', quality: 'AB FAQ' });
    expect(g.rows).toHaveLength(3);
    expect(g.rows.map((r) => r.receiver).sort()).toEqual(['Gone Roasters', 'Nestrade', 'Nestrade']);
    expect(g.rows.find((r) => r.receiver === 'Gone Roasters')).toMatchObject({ live: false, tab: 'bulk', quality: 'PB', coffee_key: 'pb|' });
    expect(g.rows.find((r) => r.sample_id === nestrade1)).toMatchObject({ live: true, status: 'requested', coffee_key: 'aa faq|', quality: 'AA FAQ' });
    expect(groups.find((x) => x.ref === 'SL-9001')).toBeUndefined();
    expect((await pool.query(`SELECT count(*)::int AS n FROM lot_conflicts WHERE ref = 'TYPE-9113'`)).rows[0].n).toBe(3);
  });

  it('--apply keeps the ref on the oldest coffee, re-issues the others (one new ref per coffee) with an event + QC change alert, then clears the conflicts', async () => {
    const before = (await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'TYPE'`)).rows[0].next_val as number;
    const report = await applyLotConflicts(pool);
    expect(report.reissued).toHaveLength(2);
    expect(report.dropped).toHaveLength(1);
    expect(report.dropped[0]).toMatchObject({ tab: 'bulk', ref: 'TYPE-9113' });
    const newRef = `TYPE-${before}`;
    for (const r of report.reissued) expect(r).toMatchObject({ tab: 'bulk', from: 'TYPE-9113', to: newRef, receiver: 'Nestrade' });
    expect((await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'TYPE'`)).rows[0].next_val).toBe(before + 1);

    // The rows: both AA FAQ sends now share the new ref; the AB FAQ sends keep TYPE-9113.
    const { rows } = await pool.query(`SELECT client, sample_ref FROM bulk_samples WHERE id = ANY($1::uuid[]) ORDER BY created_at`, [[nestrade1, nestrade2]]);
    expect(rows.map((r) => r.sample_ref)).toEqual([newRef, newRef]);
    expect((await liveSends(pool, 'TYPE-9113', { limit: 20 })).map((s) => s.receiver)).toEqual(['Late Roasters', 'Beyers', 'Joh Johanson']);
    expect((await liveSends(pool, newRef, { limit: 20 })).map((s) => s.id).sort()).toEqual([nestrade1, nestrade2].sort());
    // The lots: the old one untouched, the new one names AA FAQ.
    expect(await findLot(pool, 'TYPE-9113')).toMatchObject({ coffee_key: 'ab faq|', quality: 'AB FAQ' });
    expect(await findLot(pool, newRef)).toMatchObject({ book: 'commercial', coffee_key: 'aa faq|', quality: 'AA FAQ', created_by: LOT_CONFLICTS_ACTOR });
    // Audit + QC alert per re-issued row.
    const ev = await pool.query(`SELECT note, actor FROM events WHERE entity_type = 'bulk' AND entity_id = $1 AND type = 'edited'`, [nestrade1]);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].actor).toBe(LOT_CONFLICTS_ACTOR);
    expect(ev.rows[0].note).toMatch(new RegExp(`TYPE-9113 → ${newRef}`));
    const ob = await pool.query(`SELECT recipient, actor, payload FROM notifications_outbox WHERE event = 'request_edited' AND sample_id = ANY($1::uuid[]) ORDER BY created_at`, [[nestrade1, nestrade2]]);
    expect(ob.rows).toHaveLength(2);
    expect(ob.rows[0]).toMatchObject({ recipient: 'qc', actor: LOT_CONFLICTS_ACTOR });
    expect(ob.rows[0].payload.changes).toEqual({ sample_ref: { from: 'TYPE-9113', to: newRef } });
    // Handled conflicts are gone; a re-run is a no-op.
    expect((await pool.query(`SELECT count(*)::int AS n FROM lot_conflicts WHERE ref = 'TYPE-9113'`)).rows[0].n).toBe(0);
    const again = await applyLotConflicts(pool);
    expect(again.reissued).toHaveLength(0);
    expect(again.dropped).toHaveLength(0);
  });
});
