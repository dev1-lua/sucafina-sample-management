import { readFileSync } from 'node:fs';
import { pool } from '../src/db.js';

export const API_KEY = 'dev-key-sucafina';

export async function resetDb() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const sql = readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}
