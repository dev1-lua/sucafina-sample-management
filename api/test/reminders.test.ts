import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';

const auth = (r: request.Test) => r.set('x-api-key', API_KEY);

// Direct inserts so the test controls created_at / delivery_on / status / follow-up fields exactly
// (bypasses the API's create-time date defaults).
type Opts = {
  createdDaysAgo?: number; awb?: string | null; courier?: string | null;
  feedback?: string | null; deliveryDaysAgo?: number | null; order?: string | null;
};

async function insSpecialty(status: string, o: Opts = {}): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO specialty_samples
       (description, receiver_company, status, created_at, awb, courier_norm, feedback_received, delivery_on, order_placed)
     VALUES ('fix','Beyers',$1::sample_status_t, now() - ($2 || ' days')::interval, $3, $4, $5,
             CASE WHEN $6::int IS NULL THEN NULL ELSE CURRENT_DATE - $6::int END, $7)
     RETURNING id`,
    [status, String(o.createdDaysAgo ?? 0), o.awb ?? null, o.courier ?? null, o.feedback ?? null,
     o.deliveryDaysAgo ?? null, o.order ?? null],
  );
  return rows[0].id as string;
}

async function insBulk(status: string, o: Opts = {}): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO bulk_samples
       (quality, client, status, created_at, awb, courier_norm, feedback_received, delivery_on, order_placed)
     VALUES ('fix','X',$1::sample_status_t, now() - ($2 || ' days')::interval, $3, $4, $5,
             CASE WHEN $6::int IS NULL THEN NULL ELSE CURRENT_DATE - $6::int END, $7)
     RETURNING id`,
    [status, String(o.createdDaysAgo ?? 0), o.awb ?? null, o.courier ?? null, o.feedback ?? null,
     o.deliveryDaysAgo ?? null, o.order ?? null],
  );
  return rows[0].id as string;
}

async function insForwarding(status: string, o: Opts = {}): Promise<string> {
  // Forwarding has no delivery_on column (reduced lifecycle).
  const { rows } = await pool.query(
    `INSERT INTO forwarding_samples
       (sender, origin, sample_ref, coffee_quality, receiver_company, id_number, status, created_at, awb, courier_norm, feedback_received, order_placed)
     VALUES ('Kenyacof','Uganda','SF','AA','Itochu','ID1',$1::sample_status_t, now() - ($2 || ' days')::interval, $3, $4, $5, $6)
     RETURNING id`,
    [status, String(o.createdDaysAgo ?? 0), o.awb ?? null, o.courier ?? null, o.feedback ?? null, o.order ?? null],
  );
  return rows[0].id as string;
}

// captured fixture ids
let r1yesA: string, r1yesB: string, r1noFresh: string, r1noAwb: string;
let r2yesA: string, r2yesDelivered: string, r2noFeedback: string, r2noFresh: string;
let r3yesA: string, r3yesResultsIn: string, r3noOrder: string, r3noRecent: string, r3noForwarding: string;

beforeAll(async () => {
  await resetDb();
  // R1 (courier-awb): requested/preparing, aged >1d, no awb & no courier
  r1yesA = await insSpecialty('requested', { createdDaysAgo: 2 });
  r1yesB = await insBulk('preparing', { createdDaysAgo: 2 });
  r1noFresh = await insSpecialty('requested', { createdDaysAgo: 0 });          // too fresh
  r1noAwb = await insSpecialty('requested', { createdDaysAgo: 2, awb: '123' }); // already has AWB
  // R2 (feedback): dispatched/delivered, aged >3d, no feedback_received
  r2yesA = await insSpecialty('dispatched', { createdDaysAgo: 4 });
  r2yesDelivered = await insSpecialty('delivered', { createdDaysAgo: 4 });      // delivered, no delivery_on
  r2noFeedback = await insSpecialty('dispatched', { createdDaysAgo: 4, feedback: 'Yes' });
  r2noFresh = await insSpecialty('dispatched', { createdDaysAgo: 0 });          // too fresh
  // R3 (order-placed): delivered/results_in, delivery_on >15d, no order_placed, not forwarding
  r3yesA = await insSpecialty('delivered', { deliveryDaysAgo: 20 });
  r3yesResultsIn = await insBulk('results_in', { deliveryDaysAgo: 20 });
  r3noOrder = await insSpecialty('delivered', { deliveryDaysAgo: 20, order: 'Yes' });
  r3noRecent = await insSpecialty('delivered', { deliveryDaysAgo: 5 });         // delivered too recently
  r3noForwarding = await insForwarding('delivered', { createdDaysAgo: 20 });    // forwarding excluded
});

const ids = (body: { items: { id: string }[] }) => body.items.map((i) => i.id);

describe('reminders', () => {
  it('R1 courier-awb: undispatched, aged, no courier/AWB', async () => {
    const res = await auth(request(app).get('/reminders/courier-awb'));
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('courier-awb');
    const got = ids(res.body);
    expect(got).toEqual(expect.arrayContaining([r1yesA, r1yesB]));
    expect(got).not.toContain(r1noFresh);
    expect(got).not.toContain(r1noAwb);
    expect(res.body.count).toBe(2);
  });

  it('R2 feedback: dispatched/delivered, aged, no feedback recorded', async () => {
    const res = await auth(request(app).get('/reminders/feedback'));
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('feedback');
    const got = ids(res.body);
    expect(got).toEqual(expect.arrayContaining([r2yesA, r2yesDelivered]));
    expect(got).not.toContain(r2noFeedback);
    expect(got).not.toContain(r2noFresh);
    expect(got).not.toContain(r3noForwarding); // forwarding parcels never get cupping feedback
    expect(res.body.count).toBe(2);
  });

  it('R3 order-placed: delivered/results_in >15d, no order, excludes forwarding', async () => {
    const res = await auth(request(app).get('/reminders/order-placed'));
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('order-placed');
    const got = ids(res.body);
    expect(got).toEqual(expect.arrayContaining([r3yesA, r3yesResultsIn]));
    expect(got).not.toContain(r3noOrder);
    expect(got).not.toContain(r3noRecent);
    expect(got).not.toContain(r3noForwarding);
    expect(res.body.count).toBe(2);
  });

  it('excludes soft-deleted rows', async () => {
    const del = await insSpecialty('requested', { createdDaysAgo: 5 });
    await pool.query(`UPDATE specialty_samples SET deleted_at = now() WHERE id = $1`, [del]);
    const res = await auth(request(app).get('/reminders/courier-awb'));
    expect(ids(res.body)).not.toContain(del);
  });
});
