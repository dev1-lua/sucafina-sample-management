import { readFileSync } from 'node:fs';
import { pool } from '../src/db.js';

export const API_KEY = 'dev-key-sucafina';

export async function resetDb() {
  // Try to truncate tables if they exist
  try {
    await pool.query(`
      TRUNCATE sample_events, samples, client_contacts, clients, chaser_digests, ref_counters CASCADE
    `);
    // Reset the ref counters to their initial values
    await pool.query(`
      DELETE FROM ref_counters;
      INSERT INTO ref_counters (prefix, next_val) VALUES ('SL', 8000), ('TYPE', 1000), ('SSKE', 108000)
    `);
  } catch (_) {
    // Tables don't exist yet, need to initialize from scratch
    try {
      await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    } catch (_) {
      // Ignore
    }
    await pool.query('CREATE SCHEMA public');

    const sql = readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8');

    // Split statements by semicolon and execute separately
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
    for (const statement of statements) {
      await pool.query(statement);
    }
  }
}
