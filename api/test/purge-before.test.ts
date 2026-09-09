import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, reapplyMigrationsFrom, API_KEY } from './helpers.js';
import { purgeBefore, restorePurge, PURGE_ACTOR, requiredFlagValue, restoreNeedsAttention } from '../src/lib/purge-before.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('migration 018 (legacy samples soft delete)', () => {
  it('adds deleted_at to samples and deleted/restored to event_type_t, idempotently', async () => {
    const sql = readFileSync(fileURLToPath(new URL('../migrations/018_legacy_samples_soft_delete.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    await reapplyMigrationsFrom('019'); // no-op today; keeps the 011 lesson (helpers.ts) honoured
    const col = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='samples' AND column_name='deleted_at'`);
    expect(col.rowCount).toBe(1);
    const vals = await pool.query(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='event_type_t'`);
    expect(vals.rows.map((r) => r.enumlabel)).toEqual(expect.arrayContaining(['deleted', 'restored']));
  });

  it('GET /samples hides soft-deleted legacy rows', async () => {
    const { rows } = await pool.query(`INSERT INTO samples (ref, quality, requested_at) VALUES ('LEG-1','AB FAQ', now()) RETURNING id`);
    await pool.query(`UPDATE samples SET deleted_at = now() WHERE id = $1`, [rows[0].id]);
    const list = await auth(request(app).get('/samples'));
    expect(list.body.data.find((s: { ref: string }) => s.ref === 'LEG-1')).toBeUndefined(); // legacy list returns { data, total, page, pageSize }
    const one = await auth(request(app).get(`/samples/${rows[0].id}`));
    expect(one.status).toBe(200); // deep links still resolve, like the three books
    await expect(auth(request(app).patch(`/samples/${rows[0].id}`)).send({ comments: 'x' })).resolves.toMatchObject({ status: 404 });
  });
});

describe('requiredFlagValue (review round 1, #3 — strict CLI flag parsing)', () => {
  it('returns undefined when the flag is absent', () => {
    expect(requiredFlagValue(['--apply'], '--before')).toBeUndefined();
  });
  it('returns the token that follows the flag', () => {
    expect(requiredFlagValue(['--before', '2026-08-01'], '--before')).toBe('2026-08-01');
  });
  it('rejects a flag with nothing after it', () => {
    expect(() => requiredFlagValue(['--restore'], '--restore')).toThrow(/--restore requires a value/);
  });
  it('rejects a flag whose "value" is actually another flag (e.g. --apply --backup-ack --i-mean-it)', () => {
    expect(() => requiredFlagValue(['--apply', '--backup-ack', '--i-mean-it'], '--backup-ack')).toThrow(/--backup-ack requires a value/);
  });
});

describe('restoreNeedsAttention (review round 1, #3 — cheap post-restore guard)', () => {
  it('flags a restore that brought samples back but reopened no consignment', () => {
    expect(restoreNeedsAttention({ specialty_samples: 1, bulk_samples: 0, forwarding_samples: 0, samples: 0 }, 0)).toBe(true);
  });
  it('does not flag a no-op restore (nothing restored)', () => {
    expect(restoreNeedsAttention({ specialty_samples: 0, bulk_samples: 0, forwarding_samples: 0, samples: 0 }, 0)).toBe(false);
  });
  it('does not flag a restore that did reopen a consignment', () => {
    expect(restoreNeedsAttention({ specialty_samples: 1, bulk_samples: 0, forwarding_samples: 0, samples: 0 }, 1)).toBe(false);
  });
});

describe('purge-before script', () => {
  let oldSpec: string, newSpec: string, oldBulk: string, oldFwd: string, oldLegacy: string, cn: string, cn2: string;
  beforeAll(async () => {
    await resetDb();
    const trader = (await auth(request(app).post('/traders')).send({ name: 'Harriet', email: 'h@sucafina.com', role: 'qc' })).body.id;
    const client = (await auth(request(app).post('/clients')).send({ name: 'Paulig', country: 'Finland' })).body.id;
    await auth(request(app).patch(`/clients/${client}`)).send({ account_owner_id: trader });
    // createSchemas (verified): specialty needs description + receiver_company; forwarding needs sender, origin,
    // sample_ref, coffee_quality, receiver_company; all three accept `date` (YYYY-MM-DD) which sets date_on.
    oldSpec = (await auth(request(app).post('/specialty-samples')).send({ description: 'AA', receiver_company: 'Paulig', qty: '300g', client_id: client, date: '2026-07-15' })).body.id;
    newSpec = (await auth(request(app).post('/specialty-samples')).send({ description: 'AA', receiver_company: 'Paulig', qty: '300g', client_id: client, date: '2026-08-02' })).body.id;
    oldBulk = (await auth(request(app).post('/bulk-samples')).send({ quality: 'AB FAQ', qty: '1kg', client: 'Paulig', client_id: client, date: '2026-06-01' })).body.id;
    oldFwd  = (await auth(request(app).post('/forwarding-samples')).send({ sender: 'Nairobi lab', origin: 'Kenya', sample_ref: 'FW-1', coffee_quality: 'AB', receiver_company: 'Paulig', qty: '200g', date: '2026-07-31' })).body.id;
    oldLegacy = (await pool.query(`INSERT INTO samples (ref, quality, requested_at) VALUES ('LEG-2','AA', '2026-05-01') RETURNING id`)).rows[0].id;
    cn = (await auth(request(app).post('/consignments')).send({ location: 'Westlands' })).body.id;
    await auth(request(app).post(`/consignments/${cn}/samples`)).send({ tab: 'specialty', ids: [oldSpec] }); // membersSchema { tab, ids }
    // A second consignment, already 'dispatched' (not the default 'open'), whose only member also goes
    // stale — review round 1, #1: closing this must not forget it was 'dispatched' before the purge.
    cn2 = (await auth(request(app).post('/consignments')).send({ location: 'Thika', status: 'dispatched' })).body.id;
    await auth(request(app).post(`/consignments/${cn2}/samples`)).send({ tab: 'forwarding', ids: [oldFwd] });
    // a pending outbox row for an old sample (POST already queued a 'created' row; this makes the assertion explicit)
    await pool.query(`INSERT INTO notifications_outbox (tab, sample_id, event, dedupe_key) VALUES ('bulk', $1, 'preparing', '') ON CONFLICT DO NOTHING`, [oldBulk]);
  });
  // NB: every POST above also queues its own 'created' outbox row (recipient 'qc'), so outbox_pending_affected
  // counts ALL pending rows targeting would-hide samples — assert with >= or compute the expected number from a query.

  it('refuses a cutoff other than 2026-08-01 without --i-mean-it', async () => {
    await expect(purgeBefore(pool, { before: '2026-09-01', apply: false })).rejects.toThrow(/i-mean-it/);
  });

  it('dry run counts and mutates nothing', async () => {
    const r = await purgeBefore(pool, { before: '2026-08-01', apply: false });
    expect(r.applied).toBe(false);
    expect(r.tables.find((t) => t.table === 'specialty_samples')).toMatchObject({ live: 2, would_hide: 1 });
    expect(r.tables.find((t) => t.table === 'samples')).toMatchObject({ would_hide: 1 });
    const expectedOutbox = (await pool.query(`SELECT count(*)::int AS n FROM notifications_outbox WHERE sent_at IS NULL AND sample_id = ANY($1::uuid[])`, [[oldSpec, oldBulk, oldFwd]])).rows[0].n;
    expect(r.outbox_pending_affected).toBe(expectedOutbox); // the 'created' rows queued by the seeding POSTs + the explicit one
    expect(r.consignments_to_close.map((c) => c.id)).toEqual([cn, cn2]);
    const live = await pool.query(`SELECT count(*)::int AS n FROM specialty_samples WHERE deleted_at IS NULL`);
    expect(live.rows[0].n).toBe(2);
  });

  it('apply requires --backup-ack', async () => {
    await expect(purgeBefore(pool, { before: '2026-08-01', apply: true })).rejects.toThrow(/backup-ack/);
  });

  it('apply hides only old rows, in one purge_ts, leaves ref_counters untouched, marks outbox, closes the empty consignment', async () => {
    const before = (await pool.query(`SELECT prefix, next_val FROM ref_counters ORDER BY prefix`)).rows;
    const r = await purgeBefore(pool, { before: '2026-08-01', apply: true, backupAck: 'backups/pre-purge-test.dump' });
    expect(r.applied).toBe(true);
    expect(r.purge_ts).toMatch(/^\d{4}-\d{2}-\d{2} /);
    expect(r.hidden).toEqual({ specialty_samples: 1, bulk_samples: 1, forwarding_samples: 1, samples: 1 });
    expect((await auth(request(app).get('/specialty-samples'))).body.data.map((s: { id: string }) => s.id)).toEqual([newSpec]);
    const ts = await pool.query(`SELECT DISTINCT deleted_at::text FROM (SELECT deleted_at FROM specialty_samples UNION ALL SELECT deleted_at FROM bulk_samples UNION ALL SELECT deleted_at FROM forwarding_samples UNION ALL SELECT deleted_at FROM samples) x WHERE deleted_at IS NOT NULL`);
    expect(ts.rows).toHaveLength(1);
    expect(ts.rows[0].deleted_at).toBe(r.purge_ts);
    const ev = await pool.query(`SELECT count(*)::int AS n FROM events WHERE type='deleted' AND actor=$1`, [PURGE_ACTOR]);
    expect(ev.rows[0].n).toBe(3);
    const lev = await pool.query(`SELECT count(*)::int AS n FROM sample_events WHERE type='deleted' AND actor=$1`, [PURGE_ACTOR]);
    expect(lev.rows[0].n).toBe(1);
    const ob = await pool.query(`SELECT sent_at, last_error FROM notifications_outbox WHERE sample_id=$1`, [oldBulk]);
    expect(ob.rows.length).toBeGreaterThan(0);
    for (const o of ob.rows) { expect(o.sent_at).not.toBeNull(); expect(o.last_error).toMatch(/^purged/); }
    const newOb = await pool.query(`SELECT sent_at FROM notifications_outbox WHERE sample_id=$1`, [newSpec]);
    expect(newOb.rows[0].sent_at).toBeNull(); // pending rows for live samples untouched
    expect((await pool.query(`SELECT status FROM consignments WHERE id=$1`, [cn])).rows[0].status).toBe('closed');
    expect((await pool.query(`SELECT status FROM consignments WHERE id=$1`, [cn2])).rows[0].status).toBe('closed');
    // review round 1, #1: the close note records what the consignment was before, per consignment
    const cnNote = await pool.query(`SELECT note FROM events WHERE entity_type='consignment' AND entity_id=$1 AND type='edited' AND note LIKE 'closed by purge%'`, [cn]);
    expect(cnNote.rows[0].note).toMatch(/\(was open\)/);
    const cn2Note = await pool.query(`SELECT note FROM events WHERE entity_type='consignment' AND entity_id=$1 AND type='edited' AND note LIKE 'closed by purge%'`, [cn2]);
    expect(cn2Note.rows[0].note).toMatch(/\(was dispatched\)/);
    expect((await pool.query(`SELECT prefix, next_val FROM ref_counters ORDER BY prefix`)).rows).toEqual(before);
    expect(r.ref_counters_after).toEqual(before);
    // second apply is a no-op
    const again = await purgeBefore(pool, { before: '2026-08-01', apply: true, backupAck: 'x' });
    expect(again.hidden).toEqual({ specialty_samples: 0, bulk_samples: 0, forwarding_samples: 0, samples: 0 });
    expect(again.consignments_to_close).toEqual([]); // both already closed
  });

  it('restore brings exactly that purge back, reopens both consignments and puts each back to its PRIOR status', async () => {
    const { rows } = await pool.query(`SELECT deleted_at::text AS ts FROM bulk_samples WHERE id=$1`, [oldBulk]);
    const r = await restorePurge(pool, { purgeTs: rows[0].ts });
    expect(r.restored).toEqual({ specialty_samples: 1, bulk_samples: 1, forwarding_samples: 1, samples: 1 });
    expect(r.consignments_reopened).toBe(2);
    expect((await auth(request(app).get('/specialty-samples'))).body.data).toHaveLength(2);
    expect((await pool.query(`SELECT count(*)::int AS n FROM events WHERE type='restored' AND actor=$1`, [PURGE_ACTOR])).rows[0].n).toBe(3);
    // review round 1, #1: cn was 'open' before the purge, cn2 was 'dispatched' — restore must not force 'open' on both
    expect((await pool.query(`SELECT status FROM consignments WHERE id=$1`, [cn])).rows[0].status).toBe('open');
    expect((await pool.query(`SELECT status FROM consignments WHERE id=$1`, [cn2])).rows[0].status).toBe('dispatched');
  });

  it('drives the hide/close set and the report from an in-transaction snapshot, not the pre-BEGIN preview (review round 1, #2)', async () => {
    // A brand new consignment, not yet attached to anything when this call starts — attached from inside
    // the injected connect(), landing in the gap between the pre-BEGIN preview and the transaction start.
    // A fix-#2 regression would size the close set off the stale pre-BEGIN preview and miss it entirely.
    const racer = (await auth(request(app).post('/clients')).send({ name: 'RaceCo', country: 'Kenya' })).body.id;
    const raceSpec = (await auth(request(app).post('/specialty-samples')).send({ description: 'AA', receiver_company: 'RaceCo', qty: '300g', client_id: racer, date: '2026-07-01' })).body.id;
    const raceCn = (await auth(request(app).post('/consignments')).send({ location: 'Race' })).body.id;
    let attached = false;
    const racyDb = {
      query: pool.query.bind(pool),
      connect: async () => {
        if (!attached) {
          attached = true;
          await auth(request(app).post(`/consignments/${raceCn}/samples`)).send({ tab: 'specialty', ids: [raceSpec] });
        }
        return pool.connect();
      },
    };
    const r = await purgeBefore(racyDb as unknown as typeof pool, { before: '2026-08-01', apply: true, backupAck: 'x' });
    expect(r.consignments_to_close.map((c) => c.id)).toContain(raceCn);
    expect((await pool.query(`SELECT status FROM consignments WHERE id=$1`, [raceCn])).rows[0].status).toBe('closed');
  });
});
