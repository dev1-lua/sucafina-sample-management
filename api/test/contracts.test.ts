import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../src/db.js';
import { resetDb, reapplyMigrationsFrom } from './helpers.js';
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
