import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, reapplyMigrationsFrom, API_KEY } from './helpers.js';
import { errorHandler } from '../src/errors.js';
import { issueRef } from '../src/lib/refs.js';
import {
  containerState, contractStatusFrom, containerStates,
  type PssRow, type ContainerState, type ContractStatus,
} from '../src/lib/contracts.js';

// Phase 5 — Contracts + pre-shipment samples (Harriet, round 6: "PSS must be sent 45 days before
// shipment; nest samples per contract into number of PSS and containers; client can reject one out of X").

beforeAll(async () => {
  await resetDb();
});

describe('migration 020 — contracts + PSS schema', () => {
  beforeAll(async () => {
    // Re-applying every file from 020 on a fresh DB is what deploy-api.sh does on each deploy.
    await reapplyMigrationsFrom('020');
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM contracts`);
  });

  it('creates contracts with a generated 45-day PSS due date', async () => {
    const { rows } = await pool.query(
      `INSERT INTO contracts (contract_number, shipment_date, containers, pss_expected)
       VALUES ('MIG-020-A', '2026-10-20', 2, 2) RETURNING *`,
    );
    expect(rows[0].pss_due_date).toBe('2026-09-05');
    expect(rows[0].status).toBe('open');
    expect(rows[0].source).toBe('manual');
    expect(rows[0].deleted_at).toBeNull();
  });

  it('rejects a second live contract with the same number, case- and space-insensitively', async () => {
    await pool.query(`INSERT INTO contracts (contract_number) VALUES (' ct-2026-14 ')`);
    await expect(
      pool.query(`INSERT INTO contracts (contract_number) VALUES ('CT-2026-14')`),
    ).rejects.toThrow(/contracts_number_live_idx/);
    // …but a soft-deleted one frees the number again.
    await pool.query(`UPDATE contracts SET deleted_at = now() WHERE upper(trim(contract_number)) = 'CT-2026-14'`);
    await pool.query(`INSERT INTO contracts (contract_number) VALUES ('CT-2026-14')`);
  });

  it('adds pss_imports with the columns POST /notifications/outbox-mark needs', async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'pss_imports'`,
    );
    const cols = rows.map((r) => r.column_name);
    for (const c of ['file_url', 'file_name', 'rows', 'status', 'deleted_at', 'updated_at']) {
      expect(cols).toContain(c);
    }
  });

  it('adds contract_id / container_no / replaces_sample_id to both sample books', async () => {
    for (const table of ['bulk_samples', 'specialty_samples']) {
      const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table],
      );
      const cols = rows.map((r) => r.column_name);
      expect(cols).toContain('contract_id');
      expect(cols).toContain('container_no');
      expect(cols).toContain('replaces_sample_id');
    }
  });

  it('widens entity_type_scope with contract and import', async () => {
    const { rows } = await pool.query(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'entity_type_scope'`,
    );
    const labels = rows.map((r) => r.enumlabel);
    expect(labels).toContain('contract');
    expect(labels).toContain('import');
  });

  it('issueRef rides a caller transaction — a rollback un-issues the ref', async () => {
    const before = await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'SSKE'`);
    const client = await pool.connect();
    let ref: string;
    try {
      await client.query('BEGIN');
      ref = await issueRef('pss', client);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(ref!).toBe(`SSKE-${before.rows[0].next_val}`);
    const after = await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'SSKE'`);
    expect(after.rows[0].next_val).toBe(before.rows[0].next_val);
  });
});

// ---------------------------------------------------------------------------------------------------
// The status machine, as pure functions: one container's live PSS rows → a container state, the
// containers' states → the contract's status. No DB, so every branch is cheap to pin down.
// ---------------------------------------------------------------------------------------------------

const pss = (o: Partial<PssRow> = {}): PssRow => ({
  tab: 'bulk', id: 'x', ref: null, container_no: 1, status: 'requested',
  result_norm: null, replaces_sample_id: null, awb: null, dispatched_on: null, result_on: null, ...o,
});

describe('containerState', () => {
  const cases: [string, PssRow[], ContainerState][] = [
    ['no PSS drawn yet', [], 'none'],
    ['drawn, no verdict', [pss()], 'pending'],
    ['dispatched, feedback still owed', [pss({ status: 'dispatched', result_norm: 'pending_feedback' })], 'pending'],
    ['approved', [pss({ result_norm: 'approved' })], 'approved'],
    ['approved after a rejection', [pss({ result_norm: 'rejected' }), pss({ id: 'r', result_norm: 'approved' })], 'approved'],
    ['one rejection — a replacement is owed', [pss({ result_norm: 'rejected' })], 'replacement_pending'],
    ['rejection plus its pending replacement', [pss({ result_norm: 'rejected' }), pss({ id: 'r', replaces_sample_id: 'x' })], 'replacement_pending'],
    ['the client rejected twice — the container has failed', [pss({ result_norm: 'rejected' }), pss({ id: 'r', result_norm: 'rejected' })], 'failed'],
  ];
  it.each(cases)('%s', (_name, rows, expected) => {
    expect(containerState(rows)).toBe(expected);
  });
});

describe('contractStatusFrom', () => {
  const cases: [string, ContainerState[], ContractStatus, ContractStatus][] = [
    ['nothing drawn yet', ['none', 'none'], 'open', 'open'],
    ['all drawn, no verdicts', ['pending', 'pending'], 'open', 'pss_pending'],
    ['one drawn, one still missing', ['pending', 'none'], 'open', 'pss_pending'],
    ['one approved, one waiting', ['approved', 'pending'], 'pss_pending', 'pss_partial'],
    ['a replacement is owed', ['replacement_pending', 'pending'], 'pss_pending', 'pss_partial'],
    ['every container approved', ['approved', 'approved'], 'pss_partial', 'pss_approved'],
    ['a failed container beats everything else', ['approved', 'failed'], 'pss_partial', 'pss_rejected'],
    ['shipped is sticky', ['approved', 'pending'], 'shipped', 'shipped'],
    ['cancelled is sticky', ['failed', 'failed'], 'cancelled', 'cancelled'],
  ];
  it.each(cases)('%s', (_name, states, current, expected) => {
    expect(contractStatusFrom(states, current)).toBe(expected);
  });
});

describe('containerStates', () => {
  it('buckets rows into containers 1..pss_expected and leaves unassigned rows out', () => {
    const rows = [
      pss({ id: 'a', container_no: 1, result_norm: 'approved' }),
      pss({ id: 'b', container_no: 2, result_norm: 'rejected' }),
      pss({ id: 'c', container_no: null }),
    ];
    const states = containerStates(rows, 3);
    expect(states.map((s) => s.container_no)).toEqual([1, 2, 3]);
    expect(states.map((s) => s.state)).toEqual(['approved', 'replacement_pending', 'none']);
    expect(states[0].samples.map((s) => s.id)).toEqual(['a']);
    expect(states[2].samples).toEqual([]);
    expect(states.flatMap((s) => s.samples).map((s) => s.id)).not.toContain('c');
  });
});

// ---------------------------------------------------------------------------------------------------
// The routes, against the real database: draw / approve / reject a contract's PSS, the 45-day sweep,
// the bulk-book views on top of them, and the contract's own lifecycle.
// ---------------------------------------------------------------------------------------------------

const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'dashboard:Ivo');
type Row = Record<string, any>;

describe('/contracts', () => {
  let clientId = '';

  beforeAll(async () => {
    const t = await auth(request(app).post('/traders')).send({ name: 'Amara', email: 'amara@sucafina.com', role: 'trader' });
    const c = await auth(request(app).post('/clients')).send({ name: 'Container Roasters', country: 'Belgium' });
    clientId = c.body.id;
    // The account manager is who PSS alerts reach (migration 014) — set on the client, not at create.
    await auth(request(app).patch(`/clients/${clientId}`)).send({ account_owner_id: t.body.id });
  });

  // Dates are asked of Postgres so the assertions cannot drift with the host's timezone.
  const dateIn = async (days: number): Promise<string> =>
    (await pool.query(`SELECT to_char(current_date + $1::int, 'YYYY-MM-DD') AS d`, [days])).rows[0].d;

  const mkContract = async (body: Record<string, unknown>): Promise<Row> => {
    const res = await auth(request(app).post('/contracts'))
      .send({ client_id: clientId, quality: 'AB FAQ', destination: 'Belgium', ...body });
    expect(res.status).toBe(201);
    return res.body;
  };
  const getContract = async (id: string): Promise<Row> => (await auth(request(app).get(`/contracts/${id}`))).body;
  const pssRows = async (contractId: string): Promise<Row[]> =>
    (await pool.query(
      `SELECT * FROM bulk_samples WHERE contract_id = $1 AND deleted_at IS NULL ORDER BY container_no, created_at`,
      [contractId])).rows;
  const verdict = (id: string, result_norm: string, rejection_reason?: string) =>
    auth(request(app).patch(`/bulk-samples/${id}`)).send({ result_norm, ...(rejection_reason ? { rejection_reason } : {}) });
  const outboxFor = async (id: string): Promise<Row[]> =>
    (await pool.query(`SELECT * FROM notifications_outbox WHERE sample_id = $1 ORDER BY created_at`, [id])).rows;

  it('1. create with create_pss draws one PSS per container, quietly', async () => {
    const c = await mkContract({ contract_number: 'CT-2026-01', containers: 2, create_pss: true });
    expect(c.pss_expected).toBe(2);
    expect(c.status).toBe('pss_pending');
    const rows = await pssRows(c.id);
    expect(rows.map((r) => r.sample_ref)).toEqual(['SSKE-108000', 'SSKE-108001']);
    expect(rows.map((r) => r.container_no)).toEqual([1, 2]);
    for (const r of rows) {
      expect(r.sample_type_norm).toBe('pss');
      expect(r.status).toBe('requested');
      expect(r.qty).toBe('1kg');
      expect(r.qty_grams).toBe(1000);
      expect(r.quality).toBe('AB FAQ');
      expect(r.client).toBe('Container Roasters');
      expect(r.client_id).toBe(clientId);
      expect(r.country).toBe('Belgium');
      expect(r.contract_number).toBe('CT-2026-01');
      expect(r.replaces_sample_id).toBeNull();
    }
    // A first draw is silent: only a replacement pings QC.
    const { rows: pings } = await pool.query(
      `SELECT o.* FROM notifications_outbox o JOIN bulk_samples b ON b.id = o.sample_id WHERE b.contract_id = $1`, [c.id]);
    expect(pings).toEqual([]);
    // The contract's own timeline carries the create and the recompute.
    expect((await getContract(c.id)).events.map((e: Row) => e.type)).toEqual(['created', 'status_change']);
  });

  it('2. approvals walk the contract from partial to approved', async () => {
    const c = await mkContract({ contract_number: 'CT-2026-02', containers: 2, create_pss: true });
    const rows = await pssRows(c.id);
    expect((await verdict(rows[0].id, 'approved')).status).toBe(200);
    let d = await getContract(c.id);
    expect(d.status).toBe('pss_partial');
    expect(d.pss_counts).toEqual({ expected: 2, approved: 1, rejected: 0, pending: 1 });
    expect(d.containers.map((x: Row) => x.state)).toEqual(['approved', 'pending']);
    await verdict(rows[1].id, 'approved');
    d = await getContract(c.id);
    expect(d.status).toBe('pss_approved');
    expect(d.pss_counts).toEqual({ expected: 2, approved: 2, rejected: 0, pending: 0 });
  });

  it('3. the first rejection on a container draws a replacement and tells QC why', async () => {
    const c = await mkContract({ contract_number: 'CT-2026-03', containers: 2, create_pss: true });
    const rejected = (await pssRows(c.id))[1];             // container 2
    const res = await verdict(rejected.id, 'rejected', 'moldy');
    expect(res.status).toBe(200);
    expect(res.body.replacement_ref).toMatch(/^SSKE-/);

    const replacement = (await pssRows(c.id)).find((r) => r.replaces_sample_id === rejected.id)!;
    expect(replacement.sample_ref).toBe(res.body.replacement_ref);
    expect(replacement.container_no).toBe(2);
    expect(replacement.status).toBe('requested');
    expect(replacement.comments).toBe(`Replacement PSS for ${rejected.sample_ref} — client rejected: moldy`);

    const pings = await outboxFor(replacement.id);
    expect(pings).toHaveLength(1);
    expect(pings[0].event).toBe('created');
    expect(pings[0].recipient).toBe('qc');
    expect(pings[0].payload).toEqual({ replacement_of: rejected.sample_ref, reason: 'moldy' });

    const d = await getContract(c.id);
    expect(d.containers.map((x: Row) => x.state)).toEqual(['pending', 'replacement_pending']);
    expect(d.status).toBe('pss_partial');
  });

  it('4. a second rejection fails the container, flags the contract and reaches the outbox', async () => {
    const c = await mkContract({ contract_number: 'CT-2026-04', containers: 1, create_pss: true });
    const first = (await pssRows(c.id))[0];
    await verdict(first.id, 'rejected', 'moldy');
    const replacement = (await pssRows(c.id)).find((r) => r.replaces_sample_id === first.id)!;
    const res = await verdict(replacement.id, 'rejected', 'sour');
    expect(res.body.replacement_ref).toBeNull();          // no third draw

    const d = await getContract(c.id);
    expect(d.containers[0].state).toBe('failed');
    expect(d.status).toBe('pss_rejected');

    const flags = (await outboxFor(c.id)).filter((r) => r.event === 'pss_rejected');
    expect(flags).toHaveLength(1);
    expect(flags[0].tab).toBe('contract');
    expect(flags[0].recipient).toBe('qc');
    expect(flags[0].payload).toEqual({ contract_number: 'CT-2026-04', client_name: 'Container Roasters', failed_containers: [1] });

    const pending = await auth(request(app).get('/notifications/outbox-pending'));
    const item = pending.body.items.find((i: Row) => i.outbox_id === flags[0].id);
    expect(item.tab).toBe('contract');
    expect(item.ref).toBe('CT-2026-04');
    expect(item.title).toBe('AB FAQ');
    expect(item.client_name).toBe('Container Roasters');
    expect(item.recipients.map((r: Row) => r.name)).toEqual(['Amara']);
    const mark = await auth(request(app).post('/notifications/outbox-mark')).send({ id: item.outbox_id, via: 'teams', detail: 'Amara' });
    expect(mark.status).toBe(200);
    const { rows } = await pool.query(`SELECT type, note FROM events WHERE entity_id = $1 AND type = 'notified'`, [c.id]);
    expect(rows[0].note).toMatch(/PSS rejected twice/);
  });

  it('5. the sweep pings due-soon and overdue contracts once each', async () => {
    const soon = await mkContract({ contract_number: 'CT-2026-05A', containers: 1, shipment_date: await dateIn(59), create_pss: true });
    const late = await mkContract({ contract_number: 'CT-2026-05B', containers: 1, shipment_date: await dateIn(41), create_pss: true });
    expect(soon.pss_due_date).toBe(await dateIn(14));
    expect(late.pss_due_date).toBe(await dateIn(-4));

    const first = await auth(request(app).post('/contracts/pss-sweep')).send({});
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ due_soon: 1, overdue: 1 });
    // A second pass the same day dedupes into nothing, and says so: the counts are rows QUEUED.
    const again = await auth(request(app).post('/contracts/pss-sweep')).send({});
    expect(again.body).toEqual({ due_soon: 0, overdue: 0 });

    const dueSoon = (await outboxFor(soon.id)).filter((r) => r.event === 'pss_due_soon');
    expect(dueSoon).toHaveLength(1);
    expect(dueSoon[0].dedupe_key).toBe('D14');
    expect(dueSoon[0].payload.missing_pss).toBe(1);
    expect(dueSoon[0].payload.days_left).toBe(14);
    expect(dueSoon[0].payload.expected).toBe(1);

    const { rows: [{ week }] } = await pool.query(`SELECT to_char(current_date, 'IYYY-"W"IW') AS week`);
    const overdue = (await outboxFor(late.id)).filter((r) => r.event === 'pss_overdue');
    expect(overdue).toHaveLength(1);
    expect(overdue[0].dedupe_key).toBe(week);
    expect(overdue[0].payload.overdue_days).toBe(4);

    const due = await auth(request(app).get('/contracts/pss-due?days=14'));
    expect(due.status).toBe(200);
    const items: Row[] = due.body.items;
    expect(items.map((i) => i.contract_number)).toEqual(['CT-2026-05B', 'CT-2026-05A']);
    expect(items.every((i) => i.missing_pss === 1)).toBe(true);
  });

  it('6. the bulk book filters and sorts by the contract due date, and auto-links a PSS by number', async () => {
    const overdue = await auth(request(app).get('/bulk-samples?pss_overdue=true'));
    expect(overdue.status).toBe(200);
    expect(overdue.body.data).toHaveLength(1);
    expect(overdue.body.data[0].contract_number).toBe('CT-2026-05B');
    expect(overdue.body.data[0].pss_due_date).toBe(await dateIn(-4));

    const sorted = await auth(request(app).get('/bulk-samples?sort=pss_due_date&order=asc&pageSize=100'));
    expect(sorted.status).toBe(200);
    const dated = sorted.body.data.filter((r: Row) => r.pss_due_date).map((r: Row) => r.pss_due_date);
    expect(dated).toEqual([...dated].sort());

    const within = await auth(request(app).get('/bulk-samples?pss_due_within=14'));
    expect(within.body.data.map((r: Row) => r.contract_number).sort()).toEqual(['CT-2026-05A', 'CT-2026-05B']);
    expect((await auth(request(app).get('/bulk-samples?pss_due_within=soon'))).status).toBe(400);

    const target = await mkContract({ contract_number: 'CT-2026-14', containers: 2 });
    const one = await auth(request(app).post('/bulk-samples'))
      .send({ quality: 'AB FAQ', client: 'Container Roasters', sample_type: 'pss', contract_number: 'CT-2026-14' });
    expect(one.status).toBe(201);
    expect(one.body.contract_id).toBe(target.id);
    expect(one.body.container_no).toBe(1);
    const two = await auth(request(app).post('/bulk-samples'))
      .send({ quality: 'AB FAQ', client: 'Container Roasters', sample_type: 'pss', contract_number: ' ct-2026-14 ' });
    expect(two.body.container_no).toBe(2);
    expect((await getContract(target.id)).status).toBe('pss_pending');
    // A non-PSS row naming the same contract is left alone.
    const other = await auth(request(app).post('/bulk-samples'))
      .send({ quality: 'AB FAQ', client: 'Container Roasters', sample_type: 'type', contract_number: 'CT-2026-14' });
    expect(other.body.contract_id).toBeNull();
    expect(other.body.container_no).toBeNull();
  });

  it('7. duplicate numbers are refused; draw-pss guards a busy container; link attaches an existing sample', async () => {
    await mkContract({ contract_number: 'CT-2026-08' });
    const dup = await auth(request(app).post('/contracts')).send({ contract_number: ' ct-2026-08 ' });
    expect(dup.status).toBe(409);

    const c = await mkContract({ contract_number: 'CT-2026-09', containers: 2 });
    const drawn = await auth(request(app).post(`/contracts/${c.id}/draw-pss`)).send({ container_no: 1 });
    expect(drawn.status).toBe(201);
    expect(drawn.body.sample_ref).toMatch(/^SSKE-/);
    expect((await auth(request(app).post(`/contracts/${c.id}/draw-pss`)).send({ container_no: 1 })).status).toBe(409);

    const s = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'PSS lot', receiver_company: 'Container Roasters', sample_type_norm: 'pss', client_id: clientId });
    const link = await auth(request(app).post(`/contracts/${c.id}/link`)).send({ tab: 'specialty', sample_id: s.body.id });
    expect(link.status).toBe(200);
    expect(link.body.container_no).toBe(2);
    const { rows } = await pool.query(`SELECT contract_id, contract_number, container_no FROM specialty_samples WHERE id = $1`, [s.body.id]);
    expect(rows[0]).toEqual({ contract_id: c.id, contract_number: 'CT-2026-09', container_no: 2 });
    const d = await getContract(c.id);
    expect(d.containers.map((x: Row) => x.state)).toEqual(['pending', 'pending']);
    expect(d.containers[1].samples[0].tab).toBe('specialty');
    expect(d.status).toBe('pss_pending');
    expect(d.unassigned).toEqual([]);
    expect(d.client.account_owner.name).toBe('Amara');
  });

  it('8. GET /contracts lists with counts, filters by status and overdue, and searches', async () => {
    const list = await auth(request(app).get('/contracts?pageSize=100'));
    expect(list.status).toBe(200);
    expect(list.body.data.find((r: Row) => r.contract_number === 'CT-2026-04').pss_counts)
      .toEqual({ expected: 1, approved: 0, rejected: 1, pending: 0 });
    const flagged = await auth(request(app).get('/contracts?status=pss_rejected'));
    expect(flagged.body.data.map((r: Row) => r.contract_number)).toEqual(['CT-2026-04']);
    expect((await auth(request(app).get('/contracts?status=bogus'))).status).toBe(400);
    const over = await auth(request(app).get('/contracts?overdue=true'));
    expect(over.body.data.map((r: Row) => r.contract_number)).toEqual(['CT-2026-05B']);
    const q = await auth(request(app).get('/contracts?q=CT-2026-05A'));
    expect(q.body.total).toBe(1);
  });

  it('9. shipped sticks, and a deleted contract announces itself while its samples keep the link', async () => {
    const c = await mkContract({ contract_number: 'CT-2026-07', containers: 2, create_pss: true });
    const rows = await pssRows(c.id);
    const shipped = await auth(request(app).patch(`/contracts/${c.id}`)).send({ status: 'shipped' });
    expect(shipped.status).toBe(200);
    expect(shipped.body.status).toBe('shipped');
    await verdict(rows[0].id, 'approved');
    expect((await getContract(c.id)).status).toBe('shipped');

    expect((await auth(request(app).delete(`/contracts/${c.id}`))).status).toBe(200);
    expect((await auth(request(app).get(`/contracts/${c.id}`))).status).toBe(404);
    const kept = await pool.query(`SELECT contract_id FROM bulk_samples WHERE id = $1`, [rows[0].id]);
    expect(kept.rows[0].contract_id).toBe(c.id);
    const deleted = (await outboxFor(c.id)).filter((r) => r.event === 'deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0].tab).toBe('contract');
    expect(deleted[0].payload).toEqual({ contract_number: 'CT-2026-07' });
    // A deleted contract still surfaces for its own alert, and can be marked sent.
    const pending = await auth(request(app).get('/notifications/outbox-pending'));
    const item = pending.body.items.find((i: Row) => i.outbox_id === deleted[0].id);
    expect(item.ref).toBe('CT-2026-07');
    expect((await auth(request(app).post('/notifications/outbox-mark')).send({ id: item.outbox_id, via: 'email' })).status).toBe(200);
  });

  it('10. pss_counts ignores unassigned rows and puts every container in exactly one bucket', async () => {
    const c = await mkContract({ contract_number: 'CT-2026-10', containers: 2, create_pss: true });
    const first = (await pssRows(c.id))[0];                       // container 1
    await verdict(first.id, 'rejected', 'bad');
    const replacement = (await pssRows(c.id)).find((r) => r.replaces_sample_id === first.id)!;
    await verdict(replacement.id, 'rejected', 'worse');           // container 1 has now failed
    expect((await getContract(c.id)).pss_counts).toEqual({ expected: 2, approved: 0, rejected: 1, pending: 1 });

    // A third draw on the failed container, approved: an approval ends the container, so it must be
    // counted ONCE, as approved — never in both the approved and the rejected bucket.
    const third = await auth(request(app).post(`/contracts/${c.id}/draw-pss`)).send({ container_no: 1 });
    expect(third.status).toBe(201);
    await verdict(third.body.id, 'approved');

    // A PSS pinned to the contract but to no container must not move the headline numbers at all.
    const loose = await auth(request(app).post('/bulk-samples'))
      .send({ quality: 'AB FAQ', client: 'Container Roasters', sample_type: 'pss', contract_id: c.id });
    expect(loose.body.container_no).toBeNull();
    await verdict(loose.body.id, 'approved');

    const d = await getContract(c.id);
    expect(d.pss_counts).toEqual({ expected: 2, approved: 1, rejected: 0, pending: 1 });
    expect(d.unassigned.map((r: Row) => r.id)).toEqual([loose.body.id]);
    // …and the counts agree with the container states they summarise (the whole point of the fix).
    expect(d.containers.map((x: Row) => x.state)).toEqual(['approved', 'pending']);
    expect(d.pss_counts.approved).toBe(d.containers.filter((x: Row) => x.state === 'approved').length);
    expect(d.pss_counts.rejected).toBe(d.containers.filter((x: Row) => x.state === 'failed').length);
    expect(d.pss_counts.pending).toBeGreaterThanOrEqual(0);
    expect(d.status).toBe('pss_partial');
    // The list roll-up runs the same SQL and must say the same thing.
    const list = await auth(request(app).get('/contracts?q=CT-2026-10'));
    expect(list.body.data[0].pss_counts).toEqual({ expected: 2, approved: 1, rejected: 0, pending: 1 });
  });

  it('11. a rejected → approved → rejected flip-flop draws only one replacement', async () => {
    const c = await mkContract({ contract_number: 'CT-2026-11', containers: 1, create_pss: true });
    const row = (await pssRows(c.id))[0];
    expect((await verdict(row.id, 'rejected', 'moldy')).body.replacement_ref).toMatch(/^SSKE-/);
    await verdict(row.id, 'approved');
    const again = await verdict(row.id, 'rejected', 'moldy again');
    expect(again.body.replacement_ref).toBeNull();
    expect((await pssRows(c.id)).filter((r) => r.replaces_sample_id === row.id)).toHaveLength(1);
  });

  it('12. a rejection on a deleted contract draws nothing and pings nobody', async () => {
    const c = await mkContract({ contract_number: 'CT-2026-12', containers: 1, create_pss: true });
    const row = (await pssRows(c.id))[0];
    expect((await auth(request(app).delete(`/contracts/${c.id}`))).status).toBe(200);
    const before = (await pssRows(c.id)).length;

    const res = await verdict(row.id, 'rejected', 'moldy');
    expect(res.status).toBe(200);
    expect(res.body.replacement_ref).toBeNull();
    expect(await pssRows(c.id)).toHaveLength(before);
    // No replacement ⇒ no replacement ping (a plain first draw carries no payload).
    const { rows } = await pool.query(
      `SELECT o.* FROM notifications_outbox o JOIN bulk_samples b ON b.id = o.sample_id
        WHERE b.contract_id = $1 AND o.event = 'created' AND o.payload IS NOT NULL`, [c.id]);
    expect(rows).toEqual([]);
    // The route refuses to draw against it too.
    expect((await auth(request(app).post(`/contracts/${c.id}/draw-pss`)).send({ container_no: 1 })).status).toBe(404);
  });

  it('13. renaming onto a live number is a 409, and the container count is capped', async () => {
    const a = await mkContract({ contract_number: 'CT-2026-13A' });
    await mkContract({ contract_number: 'CT-2026-13B' });
    const clash = await auth(request(app).patch(`/contracts/${a.id}`)).send({ contract_number: ' ct-2026-13b ' });
    expect(clash.status).toBe(409);
    // A free number still renames, and a no-op rename onto its own number is fine.
    expect((await auth(request(app).patch(`/contracts/${a.id}`)).send({ contract_number: 'CT-2026-13C' })).status).toBe(200);
    expect((await auth(request(app).patch(`/contracts/${a.id}`)).send({ contract_number: 'CT-2026-13C' })).status).toBe(200);
    expect((await auth(request(app).post('/contracts')).send({ contract_number: 'CT-2026-13D', containers: 51 })).status).toBe(400);
    expect((await auth(request(app).patch(`/contracts/${a.id}`)).send({ pss_expected: 99 })).status).toBe(400);
  });
});

// A unique index that fires past a route's own pre-check (a concurrent insert) must read as a conflict,
// not as a broken server — the contract number index is the one this batch can actually hit.
describe('errorHandler', () => {
  it('maps a Postgres unique violation to 409', () => {
    const seen: { status: number | null; body: unknown } = { status: null, body: null };
    const res = {
      status(code: number) { seen.status = code; return this; },
      json(body: unknown) { seen.body = body; return this; },
    };
    errorHandler({ code: '23505', constraint: 'contracts_number_live_idx' },
      {} as never, res as never, (() => {}) as never);
    expect(seen.status).toBe(409);
    expect(seen.body).toEqual({ error: 'already exists', constraint: 'contracts_number_live_idx' });
  });
});
