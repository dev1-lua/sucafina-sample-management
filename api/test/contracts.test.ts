import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../src/db.js';
import { resetDb, reapplyMigrationsFrom } from './helpers.js';
import { issueRef } from '../src/lib/refs.js';

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
