import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://sucafina:sucafina@localhost:5433/sucafina';
const client = new pg.Client({ connectionString: url });
await client.connect();

if (process.argv.includes('--reset')) {
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('schema dropped');
}

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));
const files = readdirSync(migrationsDir)
  .filter((f) => /^\d+.*\.sql$/.test(f) && f !== '000_create_test_db.sql')
  .sort();

for (const f of files) {
  const sql = readFileSync(path.join(migrationsDir, f), 'utf8');
  await client.query(sql);
  console.log(`applied ${f}`);
}
console.log(`migrated ${url}`);
await client.end();
