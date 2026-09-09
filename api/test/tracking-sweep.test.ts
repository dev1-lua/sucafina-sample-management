import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';
import { pool } from '../src/db.js';
import { setProviderForTests } from '../src/lib/tracking/registry.js';
import { rowsByAwb, sweepPool } from '../src/lib/tracking/rows.js';
import { applyTracking } from '../src/lib/tracking/apply.js';
import { TrackingUnavailableError, type TrackingInfo, type TrackingProvider, type TrackingSource } from '../src/lib/tracking.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

afterEach(() => setProviderForTests('all', undefined));
afterAll(() => setProviderForTests('all', undefined));

// --- fixtures -------------------------------------------------------------------------------

function mkInfo(p: Partial<TrackingInfo> & { status: TrackingInfo['status'] }): TrackingInfo {
  const now = new Date().toISOString();
  return {
    awb: p.awb ?? 'X',
    courier: p.courier ?? 'dhl',
    status: p.status,
    exception_reason: p.exception_reason ?? null,
    last_event: p.last_event ?? null,
    last_event_at: p.last_event_at ?? now,
    location: p.location ?? null,
    eta: p.eta ?? null,
    delivered_at: p.delivered_at ?? null,
    note: p.note ?? '',
    source: p.source ?? 'dhl',
    checked_at: p.checked_at ?? now,
  };
}

/** A scripted provider for the routes: keyed by AWB, either a canned answer or a thrown error. */
class ScriptedProvider implements TrackingProvider {
  name: TrackingSource;
  answers = new Map<string, TrackingInfo | Error>();
  constructor(name: TrackingSource = 'dhl') { this.name = name; }
  async track(awb: string): Promise<TrackingInfo> {
    const a = this.answers.get(awb);
    if (a instanceof Error) throw a;
    if (!a) throw new Error(`ScriptedProvider: unscripted awb ${awb}`);
    return a;
  }
}

const PATHS = { specialty: '/specialty-samples', bulk: '/bulk-samples', forwarding: '/forwarding-samples' } as const;
type Tab = keyof typeof PATHS;

const CREATE_BODY: Record<Tab, Record<string, unknown>> = {
  specialty: { description: 'AA', receiver_company: 'X' },
  bulk: { quality: 'AAA', client: 'Y' },
  forwarding: { sender: 'Kenyacof', origin: 'Uganda', sample_ref: 'S1', coffee_quality: 'AA', receiver_company: 'Beyers' },
};

/** POST + PATCH-to-dispatched, mirroring how the dashboard actually gets a row into the pool. */
async function mkDispatched(tab: Tab, awb: string, extra: Record<string, unknown> = {}, courier = 'dhl') {
  const created = await auth(request(app).post(PATHS[tab])).send({ ...CREATE_BODY[tab], ...extra });
  expect(created.status).toBe(201);
  const patched = await auth(request(app).patch(`${PATHS[tab]}/${created.body.id}`)).send({ status: 'dispatched', courier_norm: courier, awb });
  expect(patched.status).toBe(200);
  return patched.body as { id: string };
}

// --- scenarios --------------------------------------------------------------------------------

describe('applyTracking + tracking routes', () => {
  it('1. delivered promotes + stamps delivery_on (via POST /tracking/sweep)', async () => {
    const awb = '9620551651';
    const row = await mkDispatched('bulk', awb);

    const provider = new ScriptedProvider('dhl');
    provider.answers.set(awb, mkInfo({ awb, status: 'delivered', delivered_at: '2026-09-08T09:00:00.000Z', last_event: 'Delivered' }));
    setProviderForTests('dhl', provider);

    const res = await auth(request(app).post('/tracking/sweep'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checked: 1, delivered: 1, exceptions: 0, unchanged: 0, errors: 0, skipped_no_provider: 0, remaining: 0 });

    const { rows } = await pool.query(`SELECT status, delivery_on, tracking_status FROM bulk_samples WHERE id = $1`, [row.id]);
    expect(rows[0].status).toBe('delivered');
    expect(rows[0].delivery_on).toBe('2026-09-08');
    expect(rows[0].tracking_status).toBe('delivered');

    const events = await pool.query(`SELECT * FROM events WHERE entity_id = $1 AND type = 'delivery_update'`, [row.id]);
    expect(events.rows).toHaveLength(1);

    const outbox = await pool.query(`SELECT * FROM notifications_outbox WHERE sample_id = $1 AND event = 'delivered'`, [row.id]);
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0].payload.courier).toBe('dhl');
  });

  it('2. never downgrades a results_in row, but still stamps delivery_on', async () => {
    const created = await auth(request(app).post('/specialty-samples')).send(CREATE_BODY.specialty);
    const awb = 'RESIN0001';
    await pool.query(
      `UPDATE specialty_samples SET status = 'results_in', result_norm = 'approved', awb = $2, courier_norm = 'dhl' WHERE id = $1`,
      [created.body.id, awb],
    );

    // Not in the sweep pool: status isn't 'dispatched'.
    const pool_ = await sweepPool({ limit: 100, minAgeHours: 0 });
    expect(pool_.rows.map((r) => r.id)).not.toContain(created.body.id);

    const [row] = await rowsByAwb(awb);
    expect(row.status).toBe('results_in');
    const info = mkInfo({ awb, status: 'delivered', delivered_at: '2026-09-05T00:00:00.000Z', last_event: 'Delivered' });
    const outcome = await applyTracking('specialty', row, info, 'test');
    expect(outcome).toBe('delivered');

    const { rows } = await pool.query(`SELECT status, delivery_on FROM specialty_samples WHERE id = $1`, [created.body.id]);
    expect(rows[0].status).toBe('results_in'); // never downgraded
    expect(rows[0].delivery_on).toBe('2026-09-05'); // but still stamped
  });

  it('3. exception enqueues once per reason (via POST /tracking/sweep, min_age_hours:0)', async () => {
    await resetDb();
    const awb = '9620551652';
    const row = await mkDispatched('bulk', awb);

    const provider = new ScriptedProvider('dhl');
    provider.answers.set(awb, mkInfo({ awb, status: 'exception', exception_reason: 'customs_hold', last_event: 'Held at customs' }));
    setProviderForTests('dhl', provider);

    const first = await auth(request(app).post('/tracking/sweep')).send({ min_age_hours: 0 });
    expect(first.status).toBe(200);
    expect(first.body.exceptions).toBe(1);
    expect(first.body.unchanged).toBe(0);

    const outboxAfterFirst = await pool.query(
      `SELECT * FROM notifications_outbox WHERE sample_id = $1 AND event = 'tracking_exception'`, [row.id],
    );
    expect(outboxAfterFirst.rows).toHaveLength(1);
    expect(outboxAfterFirst.rows[0].dedupe_key).toBe('customs_hold');

    // Second sweep, identical answer: unchanged, no new outbox row (dedupe no-ops even if we tried).
    const second = await auth(request(app).post('/tracking/sweep')).send({ min_age_hours: 0 });
    expect(second.status).toBe(200);
    expect(second.body.unchanged).toBe(1);
    expect(second.body.exceptions).toBe(0);

    const { rows: sampleRows } = await pool.query(`SELECT tracking_exception FROM bulk_samples WHERE id = $1`, [row.id]);
    expect(sampleRows[0].tracking_exception).toBe('customs_hold');

    // New reason: second, distinct outbox row.
    provider.answers.set(awb, mkInfo({ awb, status: 'exception', exception_reason: 'address_problem', last_event: 'Bad address' }));
    const third = await auth(request(app).post('/tracking/sweep')).send({ min_age_hours: 0 });
    expect(third.status).toBe(200);
    expect(third.body.exceptions).toBe(1);

    const outboxAfterThird = await pool.query(
      `SELECT dedupe_key FROM notifications_outbox WHERE sample_id = $1 AND event = 'tracking_exception' ORDER BY dedupe_key`, [row.id],
    );
    expect(outboxAfterThird.rows.map((r) => r.dedupe_key)).toEqual(['address_problem', 'customs_hold']);
  });

  it('4. unchanged writes no new event and only stamps tracking_checked_at', async () => {
    const created = await auth(request(app).post('/bulk-samples')).send(CREATE_BODY.bulk);
    const awb = 'UNCH0001';
    await pool.query(`UPDATE bulk_samples SET status = 'dispatched', awb = $2, courier_norm = 'dhl' WHERE id = $1`, [created.body.id, awb]);

    const info = mkInfo({ awb, status: 'in_transit', last_event: 'In transit' });
    const [rowBefore] = await rowsByAwb(awb);
    const first = await applyTracking('bulk', rowBefore, info, 'test');
    expect(first).toBe('changed');

    const afterFirst = await pool.query(`SELECT tracking_checked_at FROM bulk_samples WHERE id = $1`, [created.body.id]);
    const checkedAtFirst = afterFirst.rows[0].tracking_checked_at;
    expect(checkedAtFirst).toBeTruthy();

    await new Promise((r) => setTimeout(r, 20));
    const [rowAfterFirst] = await rowsByAwb(awb);
    const second = await applyTracking('bulk', rowAfterFirst, info, 'test');
    expect(second).toBe('unchanged');

    const events = await pool.query(`SELECT * FROM events WHERE entity_id = $1 AND type = 'delivery_update'`, [created.body.id]);
    expect(events.rows).toHaveLength(1); // exactly one — the second call wrote no event

    const afterSecond = await pool.query(`SELECT tracking_checked_at FROM bulk_samples WHERE id = $1`, [created.body.id]);
    expect(new Date(afterSecond.rows[0].tracking_checked_at).getTime()).toBeGreaterThan(new Date(checkedAtFirst).getTime());
  });

  it('5. forwarding gets status=delivered but never a delivered outbox row', async () => {
    const created = await auth(request(app).post('/forwarding-samples')).send(CREATE_BODY.forwarding);
    const awb = 'FWD00001';
    await pool.query(`UPDATE forwarding_samples SET status = 'dispatched', awb = $2, courier_norm = 'dhl' WHERE id = $1`, [created.body.id, awb]);

    const [row] = await rowsByAwb(awb);
    const info = mkInfo({ awb, status: 'delivered', delivered_at: '2026-09-07T00:00:00.000Z', last_event: 'Delivered' });
    const outcome = await applyTracking('forwarding', row, info, 'test');
    expect(outcome).toBe('delivered');

    const { rows } = await pool.query(`SELECT status FROM forwarding_samples WHERE id = $1`, [created.body.id]);
    expect(rows[0].status).toBe('delivered');

    const outbox = await pool.query(`SELECT * FROM notifications_outbox WHERE sample_id = $1 AND event = 'delivered'`, [created.body.id]);
    expect(outbox.rows).toHaveLength(0);
  });

  it('6. skipped_no_provider counts a row whose courier has no provider, and leaves it unchecked', async () => {
    await resetDb();
    const awb = '771234567890';
    const row = await mkDispatched('specialty', awb, {}, 'fedex');
    setProviderForTests('fedex', null); // forces "no provider" regardless of env

    const res = await auth(request(app).post('/tracking/sweep'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checked: 0, delivered: 0, exceptions: 0, unchanged: 0, errors: 0, skipped_no_provider: 1, remaining: 0 });

    const { rows } = await pool.query(`SELECT tracking_checked_at FROM specialty_samples WHERE id = $1`, [row.id]);
    expect(rows[0].tracking_checked_at).toBeNull();
  });

  it('7. GET /tracking/:awb returns live info + rows and persists on dispatched rows; unknown awb → unknown/none/[]', async () => {
    const awb = '9620551653';
    const row = await mkDispatched('bulk', awb);

    const provider = new ScriptedProvider('dhl');
    provider.answers.set(awb, mkInfo({ awb, status: 'in_transit', last_event: 'In transit', eta: '2026-09-15T00:00:00.000Z' }));
    setProviderForTests('dhl', provider);

    const res = await auth(request(app).get(`/tracking/${awb}`));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_transit');
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({ tab: 'bulk', id: row.id });

    const { rows } = await pool.query(`SELECT tracking_status, tracking_checked_at FROM bulk_samples WHERE id = $1`, [row.id]);
    expect(rows[0].tracking_status).toBe('in_transit');
    expect(rows[0].tracking_checked_at).toBeTruthy();

    const unknown = await auth(request(app).get('/tracking/no-such-awb-shape'));
    expect(unknown.status).toBe(200);
    expect(unknown.body.status).toBe('unknown');
    expect(unknown.body.source).toBe('none');
    expect(unknown.body.rows).toEqual([]);
  });

  it('8. TrackingUnavailableError (rate_limited) counts as an error and leaves the row untouched', async () => {
    await resetDb();
    const awb = '9620551654';
    const row = await mkDispatched('bulk', awb);

    const provider = new ScriptedProvider('dhl');
    provider.answers.set(awb, new TrackingUnavailableError('rate_limited', 'rate limited (test)'));
    setProviderForTests('dhl', provider);

    // The route deliberately logs errored AWBs (production diagnostics) — silence that expected
    // line here so the test's own output stays pristine, and restore it afterwards.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await auth(request(app).post('/tracking/sweep'));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ checked: 0, delivered: 0, exceptions: 0, unchanged: 0, errors: 1, skipped_no_provider: 0, remaining: 0 });
      expect(errSpy).toHaveBeenCalledWith('[tracking/sweep]', awb, 'rate limited (test)');
    } finally {
      errSpy.mockRestore();
    }

    const { rows } = await pool.query(`SELECT tracking_checked_at, status FROM bulk_samples WHERE id = $1`, [row.id]);
    expect(rows[0].tracking_checked_at).toBeNull();
    expect(rows[0].status).toBe('dispatched');
  });

  it('10. min_age_hours must be an integer — a fractional value 400s instead of 500ing out of make_interval()', async () => {
    const res = await auth(request(app).post('/tracking/sweep')).send({ min_age_hours: 0.5 });
    expect(res.status).toBe(400);
  });

  it('9. GET /tracking/:awb responds 503 when the provider throws TrackingUnavailableError', async () => {
    const awb = '9620551655';
    await mkDispatched('bulk', awb);

    const provider = new ScriptedProvider('dhl');
    provider.answers.set(awb, new TrackingUnavailableError('upstream', 'DHL is down (test)'));
    setProviderForTests('dhl', provider);

    const res = await auth(request(app).get(`/tracking/${awb}`));
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'DHL is down (test)', reason: 'upstream' });
  });
});
