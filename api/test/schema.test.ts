import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb } from './helpers.js';
import { pool } from '../src/db.js';

beforeAll(resetDb);

describe('schema', () => {
  it('creates all tables', async () => {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
    );
    const names = rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining(['clients', 'client_contacts', 'samples', 'sample_events', 'ref_counters', 'chaser_digests'])
    );
  });

  it('exposes logged_by on all_samples_v (migration 013)', async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'all_samples_v'`
    );
    const cols = rows.map((r) => r.column_name);
    expect(cols).toEqual(expect.arrayContaining(['requested_by', 'completed_by', 'priority', 'logged_by']));
  });

  it('seeds ref counters (SL/TYPE restarted by migration 015, one-shot marker present)', async () => {
    const { rows } = await pool.query(`SELECT prefix, next_val FROM ref_counters ORDER BY prefix`);
    expect(rows).toEqual([
      { prefix: 'CN', next_val: 1000 },
      { prefix: 'SL', next_val: 7459 },
      { prefix: 'SSKE', next_val: 108000 },
      { prefix: 'TYPE', next_val: 108 },
      { prefix: '_restart_2026_08', next_val: 0 },
    ]);
  });

  it('migration 015 is a no-op when re-applied (deploy script re-runs migration files)', async () => {
    await pool.query(`UPDATE ref_counters SET next_val = 7500 WHERE prefix = 'SL'`);
    const sql = readFileSync(new URL('../migrations/015_ref_counters_restart.sql', import.meta.url), 'utf8');
    await pool.query(sql);
    const { rows } = await pool.query(`SELECT next_val FROM ref_counters WHERE prefix = 'SL'`);
    expect(rows[0].next_val).toBe(7500);
    await pool.query(`UPDATE ref_counters SET next_val = 7459 WHERE prefix = 'SL'`);
  });
});
