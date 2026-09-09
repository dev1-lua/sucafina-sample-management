import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

export const API_KEY = 'dev-key-sucafina';

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Re-apply every migration from `fromPrefix` onwards, in order — what deploy-api.sh does on every
 * deploy. Idempotency tests must use this rather than re-running one file: an older file may DROP and
 * recreate all_samples_v in its old shape, which later migrations then have to bring forward again.
 */
export async function reapplyMigrationsFrom(fromPrefix: string) {
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d+.*\.sql$/.test(f) && f !== '000_create_test_db.sql' && f >= fromPrefix)
    .sort();
  for (const f of files) {
    await pool.query(readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  return files;
}

export async function resetDb() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d+.*\.sql$/.test(f) && f !== '000_create_test_db.sql')
    .sort();
  for (const f of files) {
    await pool.query(readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
}
