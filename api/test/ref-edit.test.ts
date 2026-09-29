import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';
import { findLot } from '../src/lib/lots.js';

// Round 11 §2: QC may re-ref a row from the dashboard. The ref names the coffee, so the new ref is checked
// against its lot with the row's coffee exactly as a create would be; the row moves lots in one transaction
// and an events row 'ref_changed' records "old → new". A different coffee is refused with a plain-English message.

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

const events = async (tab: string, id: string) =>
  (await pool.query(`SELECT type, note FROM events WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at`, [tab, id])).rows;

describe('PATCH /specialty-samples/:id ref', () => {
  it('same ref (after normalisation) is a no-op: no ref_changed event, lot untouched', async () => {
    const sp = await auth(request(app).post('/specialty-samples')).send({ ref: 'TYPE-116', description: 'C FAQ', receiver_company: 'Torch', grade: 'C' });
    const p = await auth(request(app).patch(`/specialty-samples/${sp.body.id}`)).send({ ref: 'type - 116' });
    expect(p.status).toBe(200);
    expect(p.body.ref).toBe('TYPE-116');
    expect(p.body.send_id).toBe(sp.body.send_id);
    expect((await events('specialty', sp.body.id)).map((e) => e.type)).toEqual(['created']);
  });

  it('a new, unused ref moves the row: new lot registered, old lot released when orphaned, ref_changed logged', async () => {
    const sp = await auth(request(app).post('/specialty-samples')).send({ ref: 'TYPE-120', description: 'AB FAQ', receiver_company: 'Torch', outturn: '15/120', grade: 'AB' });
    expect(await findLot(pool, 'TYPE-120')).not.toBeNull();
    const p = await auth(request(app).patch(`/specialty-samples/${sp.body.id}`)).send({ ref: 'type 121' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ ref: 'TYPE-121', lot_sends: 1, send_id: sp.body.send_id });
    expect(await findLot(pool, 'TYPE-120')).toBeNull();
    expect(await findLot(pool, 'TYPE-121')).toMatchObject({ ref: 'TYPE-121', book: 'specialty', outturn: '15/120', grade: 'AB', created_by: 'test' });
    expect(await events('specialty', sp.body.id)).toEqual([
      { type: 'created', note: 'AB FAQ for Torch' },
      { type: 'ref_changed', note: 'TYPE-120 → TYPE-121' },
    ]);
    // The counter never re-issues a typed number.
    expect((await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'TYPE'`)).rows[0].next_val).toBeGreaterThan(121);
  });

  it('moving onto a ref that already names the SAME coffee joins that lot; the old lot stays while another send uses it', async () => {
    const a = await auth(request(app).post('/specialty-samples')).send({ ref: 'SL-9300', description: 'Nyeri AA', receiver_company: 'Torch', outturn: '15/9300', grade: 'AA' });
    const b = await auth(request(app).post('/specialty-samples')).send({ ref: 'SL-9301', description: 'Nyeri AA', receiver_company: 'Beyers', outturn: '15/9300', grade: 'AA' });
    const c = await auth(request(app).post('/specialty-samples')).send({ ref: 'SL-9301', description: 'Nyeri AA', receiver_company: 'Paulig', outturn: '15/9300', grade: 'AA' });
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    const p = await auth(request(app).patch(`/specialty-samples/${b.body.id}`)).send({ ref: 'SL-9300' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ ref: 'SL-9300', lot_sends: 2 });
    expect(await findLot(pool, 'SL-9301')).not.toBeNull();   // c still lives on it
    const list = await auth(request(app).get('/specialty-samples?ref=SL-9300'));
    expect(list.body.total).toBe(2);
  });

  it('a ref that names a DIFFERENT coffee is refused with 409 and a plain-English message; nothing changes', async () => {
    const ab = await auth(request(app).post('/specialty-samples')).send({ ref: 'TYPE-115', description: 'AB FAQ', receiver_company: 'Torch', grade: 'AB' });
    await auth(request(app).post('/specialty-samples')).send({ ref: 'TYPE-115', description: 'AB FAQ', receiver_company: 'Beyers', grade: 'AB' });
    await auth(request(app).post('/specialty-samples')).send({ ref: 'TYPE-115', description: 'AB FAQ', receiver_company: 'Paulig', grade: 'AB' });
    const cRow = await auth(request(app).post('/specialty-samples')).send({ ref: 'TYPE-117', description: 'C FAQ', receiver_company: 'Torch', grade: 'C' });
    const p = await auth(request(app).patch(`/specialty-samples/${cRow.body.id}`)).send({ ref: 'TYPE-115' });
    expect(p.status).toBe(409);
    expect(p.body).toMatchObject({ error: 'ref_conflict', ref: 'TYPE-115', lot: { ref: 'TYPE-115' } });
    expect(p.body.sends).toHaveLength(3);
    expect(p.body.message).toBe('TYPE-115 is AB FAQ (3 sends). This row is C FAQ — a different coffee. Give it a new ref, or correct the outturn/grade first.');
    const g = await auth(request(app).get(`/specialty-samples/${cRow.body.id}`));
    expect(g.body.ref).toBe('TYPE-117');
    expect(await findLot(pool, 'TYPE-117')).not.toBeNull();
    expect((await events('specialty', cRow.body.id)).map((e) => e.type)).toEqual(['created']);
    expect(ab.body.lot_sends).toBe(1);
  });

  it('the coffee is judged as the row will read AFTER the patch: fixing the grade and the ref together is allowed', async () => {
    const wrong = await auth(request(app).post('/specialty-samples')).send({ ref: 'TYPE-118', description: 'AB FAQ', receiver_company: 'Torch', grade: 'C' });
    const p = await auth(request(app).patch(`/specialty-samples/${wrong.body.id}`)).send({ ref: 'TYPE-115', grade: 'AB' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ ref: 'TYPE-115', grade: 'AB', lot_sends: 4 });
  });

  it('a lettered SSKE ref sets option_letter from the ref (never C in the ref, B in the column)', async () => {
    const sp = await auth(request(app).post('/specialty-samples')).send({ ref: 'SSKE-880001B', description: 'AA FAQ', receiver_company: 'Zoegas', sample_type_norm: 'pss' });
    expect(sp.body.option_letter).toBeNull();
    const p = await auth(request(app).patch(`/specialty-samples/${sp.body.id}`)).send({ ref: 'SSKE-880001C' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ ref: 'SSKE-880001C', option_letter: 'C' });
    // Both options are one contract group: the lot is the base and lot_sends counts the group.
    expect(p.body.lot_sends).toBe(1);
    expect(await findLot(pool, 'SSKE-880001C')).toMatchObject({ ref: 'SSKE-880001' });
  });

  it('the 409 message spells the coffee out for a non-expert: outturn and grade in brackets, never repeated', async () => {
    await auth(request(app).post('/specialty-samples')).send({ ref: 'SL-9350', description: 'Nyeri AA', receiver_company: 'Torch', outturn: '15/5670', grade: 'AA' });
    const other = await auth(request(app).post('/specialty-samples')).send({ ref: 'SL-9351', description: 'Kiambu', receiver_company: 'Torch', outturn: '15/9351', grade: 'AB' });
    const p = await auth(request(app).patch(`/specialty-samples/${other.body.id}`)).send({ ref: 'SL-9350' });
    expect(p.status).toBe(409);
    expect(p.body.message).toBe('SL-9350 is Nyeri AA (outturn 15/5670) (1 send). This row is Kiambu (outturn 15/9351, grade AB) — a different coffee. Give it a new ref, or correct the outturn/grade first.');
  });

  it('moving from a lettered SSKE ref to a non-lettered ref CLEARS option_letter (no stale B left behind)', async () => {
    const sp = await auth(request(app).post('/specialty-samples')).send({ ref: 'SSKE-107001B', description: 'AA FAQ', receiver_company: 'Zoegas', sample_type_norm: 'pss' });
    await pool.query(`UPDATE specialty_samples SET option_letter = 'B' WHERE id = $1`, [sp.body.id]);
    const p = await auth(request(app).patch(`/specialty-samples/${sp.body.id}`)).send({ ref: 'SL-9360' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ ref: 'SL-9360', option_letter: null });
    expect((await pool.query(`SELECT option_letter FROM specialty_samples WHERE id = $1`, [sp.body.id])).rows[0].option_letter).toBeNull();
    // And back onto a lettered ref: the column follows the ref again.
    const back = await auth(request(app).patch(`/specialty-samples/${sp.body.id}`)).send({ ref: 'SSKE-107001C' });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ ref: 'SSKE-107001C', option_letter: 'C' });
    // A PATCH without a ref leaves the letter alone.
    const other = await auth(request(app).patch(`/specialty-samples/${sp.body.id}`)).send({ comments: 'no ref here' });
    expect(other.body.option_letter).toBe('C');
  });

  it('a ref edit riding a status PATCH keeps the status event and still logs ref_changed', async () => {
    const sp = await auth(request(app).post('/specialty-samples')).send({ ref: 'SL-9400', description: 'Kiambu AB', receiver_company: 'Torch' });
    const p = await auth(request(app).patch(`/specialty-samples/${sp.body.id}`)).send({ ref: 'SL-9401', status: 'preparing' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ ref: 'SL-9401', status: 'preparing' });
    expect((await events('specialty', sp.body.id)).map((e) => e.type).sort()).toEqual(['created', 'ref_changed', 'status_change']);
  });

  it('a blank ref is a 400; the send id is not a ref', async () => {
    const sp = await auth(request(app).post('/specialty-samples')).send({ description: 'Blank', receiver_company: 'Torch' });
    expect((await auth(request(app).patch(`/specialty-samples/${sp.body.id}`)).send({ ref: '   ' })).status).toBe(400);
    expect((await auth(request(app).patch(`/specialty-samples/${sp.body.id}`)).send({ ref: '' })).status).toBe(400);
  });
});

describe('PATCH /bulk-samples/:id sample_ref', () => {
  it('new ref OK, ref_changed logged, lots moved', async () => {
    const bk = await auth(request(app).post('/bulk-samples')).send({ sample_ref: 'TYPE-9500', quality: 'AB FAQ', client: 'Torch' });
    const p = await auth(request(app).patch(`/bulk-samples/${bk.body.id}`)).send({ sample_ref: 'type-9501' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ sample_ref: 'TYPE-9501', lot_sends: 1, send_id: bk.body.send_id });
    expect(await findLot(pool, 'TYPE-9500')).toBeNull();
    expect(await findLot(pool, 'TYPE-9501')).toMatchObject({ book: 'commercial', quality: 'AB FAQ' });
    expect(await events('bulk', bk.body.id)).toEqual([
      { type: 'created', note: 'AB FAQ for Torch' },
      { type: 'ref_changed', note: 'TYPE-9500 → TYPE-9501' },
    ]);
  });

  it('different coffee → 409 with the commercial wording', async () => {
    await auth(request(app).post('/bulk-samples')).send({ sample_ref: 'TYPE-9510', quality: 'AB FAQ', client: 'Torch' });
    const c = await auth(request(app).post('/bulk-samples')).send({ sample_ref: 'TYPE-9511', quality: 'C FAQ', client: 'Torch' });
    const p = await auth(request(app).patch(`/bulk-samples/${c.body.id}`)).send({ sample_ref: 'TYPE-9510' });
    expect(p.status).toBe(409);
    expect(p.body).toMatchObject({ error: 'ref_conflict', ref: 'TYPE-9510' });
    expect(p.body.message).toBe('TYPE-9510 is AB FAQ (1 send). This row is C FAQ — a different coffee. Give it a new ref, or correct the quality/blend first.');
    expect((await auth(request(app).get(`/bulk-samples/${c.body.id}`))).body.sample_ref).toBe('TYPE-9511');
  });

  it('a lettered SSKE ref sets option_letter', async () => {
    const bk = await auth(request(app).post('/bulk-samples')).send({ sample_ref: 'SSKE-880101A', quality: 'AA FAQ', client: 'Zoegas', sample_type: 'pss' });
    const p = await auth(request(app).patch(`/bulk-samples/${bk.body.id}`)).send({ sample_ref: 'SSKE-880101B' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ sample_ref: 'SSKE-880101B', option_letter: 'B' });
  });

  it('lettered → non-lettered clears option_letter; non-lettered → lettered sets it', async () => {
    const bk = await auth(request(app).post('/bulk-samples')).send({ sample_ref: 'SSKE-107101B', quality: 'AA FAQ', client: 'Zoegas', sample_type: 'pss' });
    await pool.query(`UPDATE bulk_samples SET option_letter = 'B' WHERE id = $1`, [bk.body.id]);
    const cleared = await auth(request(app).patch(`/bulk-samples/${bk.body.id}`)).send({ sample_ref: 'TYPE-9530' });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ sample_ref: 'TYPE-9530', option_letter: null });
    expect((await pool.query(`SELECT option_letter FROM bulk_samples WHERE id = $1`, [bk.body.id])).rows[0].option_letter).toBeNull();
    const set = await auth(request(app).patch(`/bulk-samples/${bk.body.id}`)).send({ sample_ref: 'SSKE-107101C' });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ sample_ref: 'SSKE-107101C', option_letter: 'C' });
    const other = await auth(request(app).patch(`/bulk-samples/${bk.body.id}`)).send({ comments: 'no ref here' });
    expect(other.body.option_letter).toBe('C');
  });

  it('the 409 message names the blend when there is one', async () => {
    await auth(request(app).post('/bulk-samples')).send({ sample_ref: 'TYPE-9540', quality: 'AB FAQ', blend: 'Kenya / Uganda', client: 'Torch' });
    const c = await auth(request(app).post('/bulk-samples')).send({ sample_ref: 'TYPE-9541', quality: 'PB', client: 'Torch' });
    const p = await auth(request(app).patch(`/bulk-samples/${c.body.id}`)).send({ sample_ref: 'TYPE-9540' });
    expect(p.status).toBe(409);
    expect(p.body.message).toBe('TYPE-9540 is AB FAQ (blend Kenya / Uganda) (1 send). This row is PB — a different coffee. Give it a new ref, or correct the quality/blend first.');
  });

  it('the same ref is a no-op', async () => {
    const bk = await auth(request(app).post('/bulk-samples')).send({ sample_ref: 'TYPE-9520', quality: 'AB FAQ', client: 'Torch' });
    const p = await auth(request(app).patch(`/bulk-samples/${bk.body.id}`)).send({ sample_ref: 'TYPE-9520', comments: 'note' });
    expect(p.status).toBe(200);
    expect((await events('bulk', bk.body.id)).map((e) => e.type)).toEqual(['created', 'edited']);
  });
});
