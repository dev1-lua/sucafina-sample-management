import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, reapplyMigrationsFrom, API_KEY } from './helpers.js';
import { normalizeRef, normalizeQuality, coffeeKeyFor, resolveLot, findLot, claimRef, liveSends } from '../src/lib/lots.js';

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
