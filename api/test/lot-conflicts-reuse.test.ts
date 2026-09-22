import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../src/db.js';
import { resetDb, reapplyMigrationsFrom } from './helpers.js';
import { findLot, liveSends } from '../src/lib/lots.js';
import { LOT_CONFLICTS_ACTOR, applyLotConflicts } from '../src/lib/lot-conflicts.js';

// Round 10b, task 5: the ref names the coffee, so the conflict re-issue must hand out ONE new ref per
// coffee across the whole run (Beyers' and Sarutahiko's AB FAQ rows, flagged under TYPE-113 and TYPE-114,
// became TYPE-115 and TYPE-116 in prod — they are the same coffee), and must move a flagged row onto a
// lot that already names its coffee instead of burning a counter number.

beforeAll(async () => {
  await resetDb();
  // Two refs, each with an extra AB FAQ row: the oldest row fixes the lot's coffee, the AB FAQ rows are conflicts.
  await pool.query(
    `INSERT INTO bulk_samples (sample_ref, quality, client, sample_type_norm, status, created_at) VALUES
       ('TYPE-8113', 'AA FAQ', 'Joh Johanson', 'type', 'delivered', now() - interval '6 days'),
       ('TYPE-8113', 'AB FAQ', 'Beyers',       'type', 'requested', now() - interval '5 days'),
       ('TYPE-8114', 'PB',     'Nestrade',     'type', 'delivered', now() - interval '4 days'),
       ('TYPE-8114', 'AB FAQ', 'Sarutahiko',   'type', 'requested', now() - interval '3 days')`);
  // A coffee that already has its own lot (TYPE-8121 = Kenya AB) and a row flagged under another ref.
  await pool.query(
    `INSERT INTO bulk_samples (sample_ref, quality, client, sample_type_norm, status, created_at) VALUES
       ('TYPE-8120', 'AA',       'Paulig',   'type', 'delivered', now() - interval '6 days'),
       ('TYPE-8120', 'Kenya AB', 'Nestrade', 'type', 'requested', now() - interval '2 days'),
       ('TYPE-8121', 'Kenya AB', 'Beyers',   'type', 'delivered', now() - interval '5 days')`);
  await reapplyMigrationsFrom('023');
});

const counter = async () => Number((await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'TYPE'`)).rows[0].next_val);
const lotsCount = async () => Number((await pool.query(`SELECT count(*)::int AS n FROM lots`)).rows[0].n);

describe('applyLotConflicts: one new ref per coffee across groups', () => {
  it('two groups freeing the same coffee share ONE new ref and one lot', async () => {
    const before = await counter();
    const lots = await lotsCount();
    const report = await applyLotConflicts(pool, { onlyRefs: ['TYPE-8113', 'TYPE-8114'] });
    expect(report.reissued).toHaveLength(2);
    expect(report.dropped).toHaveLength(0);
    const newRef = `TYPE-${before}`;
    expect(report.reissued.map((r) => r.from).sort()).toEqual(['TYPE-8113', 'TYPE-8114']);
    for (const r of report.reissued) expect(r).toMatchObject({ to: newRef, coffee: 'AB FAQ', minted: true });
    // One counter number burned, one lot registered.
    expect(await counter()).toBe(before + 1);
    expect(await lotsCount()).toBe(lots + 1);
    expect(await findLot(pool, newRef)).toMatchObject({ book: 'commercial', coffee_key: 'ab faq|', quality: 'AB FAQ', created_by: LOT_CONFLICTS_ACTOR });
    expect((await liveSends(pool, newRef, { limit: 20 })).map((s) => s.receiver).sort()).toEqual(['Beyers', 'Sarutahiko']);
    expect((await liveSends(pool, 'TYPE-8113', { limit: 20 })).map((s) => s.receiver)).toEqual(['Joh Johanson']);
    expect((await liveSends(pool, 'TYPE-8114', { limit: 20 })).map((s) => s.receiver)).toEqual(['Nestrade']);
    expect(await findLot(pool, 'TYPE-8113')).toMatchObject({ coffee_key: 'aa faq|' });
    expect(await findLot(pool, 'TYPE-8114')).toMatchObject({ coffee_key: 'pb|' });
    expect((await pool.query(`SELECT count(*)::int AS n FROM lot_conflicts WHERE ref IN ('TYPE-8113','TYPE-8114')`)).rows[0].n).toBe(0);
  });

  it('a coffee that already has its own lot: the flagged row moves onto that ref, no counter number burned', async () => {
    const before = await counter();
    const lots = await lotsCount();
    const report = await applyLotConflicts(pool, { onlyRefs: ['TYPE-8120'] });
    expect(report.reissued).toHaveLength(1);
    expect(report.reissued[0]).toMatchObject({ from: 'TYPE-8120', to: 'TYPE-8121', receiver: 'Nestrade', coffee: 'Kenya AB', minted: false });
    expect(await counter()).toBe(before);
    expect(await lotsCount()).toBe(lots);
    expect((await liveSends(pool, 'TYPE-8121', { limit: 20 })).map((s) => s.receiver).sort()).toEqual(['Beyers', 'Nestrade']);
    expect((await liveSends(pool, 'TYPE-8120', { limit: 20 })).map((s) => s.receiver)).toEqual(['Paulig']);
    // The move is still audited + alerted like a re-issue.
    const id = (await pool.query(`SELECT id FROM bulk_samples WHERE client = 'Nestrade' AND sample_ref = 'TYPE-8121'`)).rows[0].id;
    const ev = await pool.query(`SELECT note, actor FROM events WHERE entity_type = 'bulk' AND entity_id = $1 AND type = 'edited'`, [id]);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].note).toMatch(/TYPE-8120 → TYPE-8121/);
    const ob = await pool.query(`SELECT payload FROM notifications_outbox WHERE event = 'request_edited' AND sample_id = $1`, [id]);
    expect(ob.rows).toHaveLength(1);
    expect(ob.rows[0].payload.changes).toEqual({ sample_ref: { from: 'TYPE-8120', to: 'TYPE-8121' } });
    expect((await pool.query(`SELECT count(*)::int AS n FROM lot_conflicts WHERE ref = 'TYPE-8120'`)).rows[0].n).toBe(0);
  });
});
