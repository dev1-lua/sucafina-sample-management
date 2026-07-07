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

  it('seeds ref counters', async () => {
    const { rows } = await pool.query(`SELECT prefix, next_val FROM ref_counters ORDER BY prefix`);
    expect(rows).toEqual([
      { prefix: 'SL', next_val: 8000 },
      { prefix: 'SSKE', next_val: 108000 },
      { prefix: 'TYPE', next_val: 1000 },
    ]);
  });
});
