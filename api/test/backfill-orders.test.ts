import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';
import { BACKFILL_ORDERS_ACTOR, backfillOrders, findOrderGroups } from '../src/lib/backfill-orders.js';
import { issueConsignmentNumber } from '../src/lib/refs.js';

// Round 10b, task 3: rows logged before round 10 have no order (dashboard Order column "—"). Rows that
// went out together — same non-empty AWB, same client (client_id, or the receiver text when client_id
// is null) — are one consignment; scripts/backfill-orders.ts creates it (dry run by default).

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

const AWB = '8309842892';
const count = async (sql: string, params: unknown[] = []) => Number((await pool.query(`SELECT count(*)::int AS n FROM ${sql}`, params)).rows[0].n);
const cnCounter = async () => Number((await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'CN'`)).rows[0].next_val);

describe('issueConsignmentNumber', () => {
  it('mints on the caller\'s connection when given one (a rolled-back write burns no number)', async () => {
    const before = await cnCounter();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      expect(await issueConsignmentNumber(client)).toBe(`CN-${before}`);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(await cnCounter()).toBe(before);
    expect(await issueConsignmentNumber()).toBe(`CN-${before}`);
  });
});

describe('scripts/backfill-orders', () => {
  let parlorId: string;
  let bulkIds: string[];       // 3 bulk rows, same client_id, AWB 8309842892
  let bulkOther: string;       // same client, a different AWB → group of one → skipped
  let bulkAttached: string;    // same client + AWB, already in a consignment → left alone
  let specSameClient: string;  // specialty row with the SAME client_id + AWB → joins the bulk group (one order, two books)
  let specIds: string[];       // 2 specialty rows, client_id null, same receiver text + AWB
  let specStranger: string;    // client_id null, same AWB as the bulk group, other receiver → alone → skipped
  let existingCn: string;

  beforeAll(async () => {
    parlorId = (await auth(request(app).post('/clients')).send({ name: 'Parlor Coffee', country: 'USA' })).body.id;
    const b = await pool.query(
      `INSERT INTO bulk_samples (sample_ref, quality, client, client_id, awb, courier_norm, requested_by, logged_by, status, date_on, created_at)
       VALUES ('TYPE-201', 'AB FAQ',  'Parlor Coffee', $1, $2, 'dhl', 'Ivo', 'Gloria',  'requested', '2026-09-02', now() - interval '3 hours'),
              ('TYPE-202', 'AA FAQ',  'Parlor Coffee', $1, $2, 'dhl', 'Ivo', 'Harriet', 'requested', '2026-09-02', now() - interval '2 hours'),
              ('TYPE-203', 'PB',      'Parlor Coffee', $1, $2, 'dhl', 'Ivo', NULL,      'requested', '2026-09-02', now() - interval '1 hour')
       RETURNING id`,
      [parlorId, ` ${AWB} `],
    );
    bulkIds = b.rows.map((r) => String(r.id));
    bulkOther = String((await pool.query(
      `INSERT INTO bulk_samples (sample_ref, quality, client, client_id, awb, status) VALUES ('TYPE-204', 'AB FAQ', 'Parlor Coffee', $1, '1111111111', 'requested') RETURNING id`,
      [parlorId])).rows[0].id);
    bulkAttached = String((await pool.query(
      `INSERT INTO bulk_samples (sample_ref, quality, client, client_id, awb, status) VALUES ('TYPE-205', 'AB FAQ', 'Parlor Coffee', $1, $2, 'requested') RETURNING id`,
      [parlorId, AWB])).rows[0].id);
    existingCn = (await auth(request(app).post('/consignments')).send({ client_id: parlorId, samples: [{ tab: 'bulk', id: bulkAttached }] })).body.id;
    specSameClient = String((await pool.query(
      `INSERT INTO specialty_samples (ref, description, receiver_company, client_id, awb, status, requested_by, date_on) VALUES ('SL-301', 'Nyeri AA', 'Parlor Coffee', $1, $2, 'requested', 'Ivo', '2026-09-03') RETURNING id`,
      [parlorId, AWB])).rows[0].id);
    const s = await pool.query(
      `INSERT INTO specialty_samples (ref, description, receiver_company, client_id, awb, status, delivery_on)
       VALUES ('SL-302', 'Kirinyaga AB', 'Blue Bottle', NULL, '5551234', 'delivered', '2026-09-05'),
              ('SL-303', 'Nyeri PB',     'blue bottle ', NULL, '5551234', 'delivered', '2026-09-05')
       RETURNING id`);
    specIds = s.rows.map((r) => String(r.id));
    specStranger = String((await pool.query(
      `INSERT INTO specialty_samples (ref, description, receiver_company, client_id, awb, status) VALUES ('SL-304', 'AA', 'Someone Else', NULL, $1, 'requested') RETURNING id`,
      [AWB])).rows[0].id);
    // A soft-deleted row never joins a group, whatever its AWB.
    await pool.query(
      `INSERT INTO specialty_samples (ref, description, receiver_company, client_id, awb, status, deleted_at) VALUES ('SL-305', 'AA', 'Parlor Coffee', $1, $2, 'requested', now())`,
      [parlorId, AWB]);
    // Placeholder "AWBs" from the legacy sheet ("HD" = hand delivery on 26 Connect Coffee rows; "n/a", "-"):
    // a value with fewer than 4 digits is not an AWB and never groups anything.
    await pool.query(
      `INSERT INTO bulk_samples (sample_ref, quality, client, awb, status) VALUES
         ('TYPE-206', 'AB FAQ', 'Connect Coffee', 'HD', 'requested'),
         ('TYPE-207', 'AA FAQ', 'Connect Coffee', 'hd ', 'requested'),
         ('TYPE-208', 'PB',     'Connect Coffee', 'HD', 'requested'),
         ('TYPE-209', 'PB',     'Torch',          'n/a', 'requested'),
         ('TYPE-210', 'PB',     'Torch',          'ref 12', 'requested')`);
  });

  it('a placeholder AWB (fewer than 4 digits, e.g. "HD") never forms a group; the dry run counts them', async () => {
    const { groups, placeholders } = await findOrderGroups(pool);
    expect(placeholders).toBe(5);
    expect(groups.find((g) => g.client === 'Connect Coffee')).toBeUndefined();
    expect(groups.find((g) => g.client === 'Torch')).toBeUndefined();
    expect(groups.flatMap((g) => g.rows).every((r) => /\d{4}/.test(r.awb))).toBe(true);
  });

  it('groups live, unattached rows by AWB + client (client_id, else receiver text); groups of one are skipped', async () => {
    const { groups } = await findOrderGroups(pool);
    expect(groups).toHaveLength(2);
    const parlor = groups.find((g) => g.client_id === parlorId)!;
    expect(parlor).toMatchObject({ awb: AWB, client: 'Parlor Coffee', requested_by: 'Ivo', logged_by: null, date_from: '2026-09-02', date_to: '2026-09-03' });
    expect(parlor.rows.map((r) => r.id).sort()).toEqual([...bulkIds, specSameClient].sort());
    expect(parlor.rows.filter((r) => r.tab === 'bulk')).toHaveLength(3);
    const blue = groups.find((g) => g.client_id === null)!;
    expect(blue).toMatchObject({ awb: '5551234', client: 'Blue Bottle', requested_by: null, logged_by: null });
    // The date span is read off date_on, falling back to created_at's date; both Blue Bottle rows were logged today.
    expect(blue.date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(blue.date_to).toBe(blue.date_from);
    expect(blue.rows.map((r) => r.id).sort()).toEqual([...specIds].sort());
    const all = groups.flatMap((g) => g.rows.map((r) => r.id));
    expect(all).not.toContain(bulkOther);
    expect(all).not.toContain(bulkAttached);
    expect(all).not.toContain(specStranger);
  });

  it('dry run reports the same groups and writes nothing', async () => {
    const consignments = await count('consignments');
    const counter = await cnCounter();
    const report = await backfillOrders(pool, { apply: false });
    expect(report.applied).toBe(false);
    expect(report.since).toBeNull();
    expect(report.groups).toHaveLength(2);
    expect(report.rows).toBe(6);
    expect(report.placeholders).toBe(5);
    for (const g of report.groups) expect(g.number).toBeNull();
    expect(await count('consignments')).toBe(consignments);
    expect(await cnCounter()).toBe(counter);
    expect(await count('bulk_samples WHERE consignment_id IS NOT NULL')).toBe(1);
    expect(await count('specialty_samples WHERE consignment_id IS NOT NULL')).toBe(0);
  });

  it('--apply creates one consignment per group with the right members, then a re-run is a no-op', async () => {
    const consignments = await count('consignments');
    const counter = await cnCounter();
    const report = await backfillOrders(pool, { apply: true });
    expect(report.applied).toBe(true);
    expect(report.groups).toHaveLength(2);
    expect(report.rows).toBe(6);
    expect(await count('consignments')).toBe(consignments + 2);
    expect(await cnCounter()).toBe(counter + 2);
    expect(report.groups.map((g) => g.number).sort()).toEqual([`CN-${counter}`, `CN-${counter + 1}`]);

    const parlor = report.groups.find((g) => g.client_id === parlorId)!;
    const cn = await pool.query(`SELECT * FROM consignments WHERE number = $1`, [parlor.number]);
    expect(cn.rows[0]).toMatchObject({ client_id: parlorId, requested_by: 'Ivo', logged_by: null, status: 'open', location: null, notes: `backfilled from AWB ${AWB}` });
    const got = await auth(request(app).get(`/consignments/${cn.rows[0].id}`));
    expect(got.status).toBe(200);
    expect(got.body.member_count).toBe(4);
    expect(got.body.members.map((m: { id: string }) => m.id).sort()).toEqual([...bulkIds, specSameClient].sort());
    expect(got.body.derived_status).toBe('dispatched'); // every member carries an AWB
    expect(got.body.client_name).toBe('Parlor Coffee');
    const created = got.body.events.filter((e: { type: string }) => e.type === 'created');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ actor: BACKFILL_ORDERS_ACTOR, note: `consignment ${parlor.number}` });

    const blue = report.groups.find((g) => g.client_id === null)!;
    const cn2 = await pool.query(`SELECT * FROM consignments WHERE number = $1`, [blue.number]);
    expect(cn2.rows[0]).toMatchObject({ client_id: null, requested_by: null, logged_by: null, notes: 'backfilled from AWB 5551234' });
    const got2 = await auth(request(app).get(`/consignments/${cn2.rows[0].id}`));
    expect(got2.body.members.map((m: { id: string }) => m.id).sort()).toEqual([...specIds].sort());
    expect(got2.body.derived_status).toBe('delivered');

    // Untouched: the lone AWB, the stranger, and the row that already had an order.
    const left = await pool.query(`SELECT id, consignment_id FROM bulk_samples WHERE id = ANY($1::uuid[])`, [[bulkOther, bulkAttached]]);
    expect(left.rows.find((r) => String(r.id) === bulkOther)?.consignment_id).toBeNull();
    expect(String(left.rows.find((r) => String(r.id) === bulkAttached)?.consignment_id)).toBe(existingCn);
    expect((await pool.query(`SELECT consignment_id FROM specialty_samples WHERE id = $1`, [specStranger])).rows[0].consignment_id).toBeNull();

    const again = await backfillOrders(pool, { apply: true });
    expect(again.groups).toEqual([]);
    expect(again.rows).toBe(0);
    expect(await count('consignments')).toBe(consignments + 2);
    expect(await cnCounter()).toBe(counter + 2);
  });

  it('--since: rows dated before the floor neither form nor join a group (the legacy sheet shares one AWB across whole boxes back to 2023)', async () => {
    // Two boxes to the same client: an old one (2023) and a recent one; one 2023 row straddles onto the recent AWB.
    await pool.query(
      `INSERT INTO bulk_samples (sample_ref, quality, client, awb, status, date_on) VALUES
         ('TYPE-401', 'AB FAQ', 'Torch', '2023000001', 'delivered', '2023-03-01'),
         ('TYPE-402', 'AA FAQ', 'Torch', '2023000001', 'delivered', '2023-03-02'),
         ('TYPE-403', 'PB',     'Torch', '2023000001', 'delivered', '2023-03-02'),
         ('TYPE-404', 'PB',     'Torch', '2026000002', 'delivered', '2023-03-02'),
         ('TYPE-405', 'AB FAQ', 'Torch', '2026000002', 'delivered', '2026-08-10'),
         ('TYPE-406', 'AA FAQ', 'Torch', '2026000002', 'delivered', '2026-08-11')`);
    const noFloor = await findOrderGroups(pool);
    expect(noFloor.groups.map((g) => [g.awb, g.rows.length]).sort()).toEqual([['2023000001', 3], ['2026000002', 3]]);

    const consignments = await count('consignments');
    const report = await backfillOrders(pool, { apply: true, since: '2026-08-01' });
    expect(report.since).toBe('2026-08-01');
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]).toMatchObject({ awb: '2026000002', client: 'Torch', date_from: '2026-08-10', date_to: '2026-08-11' });
    expect(report.groups[0].rows.map((r) => r.ref).sort()).toEqual(['TYPE-405', 'TYPE-406']);
    expect(await count('consignments')).toBe(consignments + 1);
    expect(await count(`bulk_samples WHERE sample_ref IN ('TYPE-401','TYPE-402','TYPE-403','TYPE-404') AND consignment_id IS NOT NULL`)).toBe(0);
    // Without a floor the 2023 box is still there to be picked up.
    expect((await backfillOrders(pool, { apply: false })).groups.map((g) => g.awb)).toEqual(['2023000001']);
  });
});
