import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

export const API_KEY = 'dev-key-sucafina';

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));

export async function resetDb() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d+.*\.sql$/.test(f) && f !== '000_create_test_db.sql')
    .sort();
  for (const f of files) {
    await pool.query(readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
}
