import { readFileSync } from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL ?? 'postgres://sucafina:sucafina@localhost:5433/sucafina';
const client = new pg.Client({ connectionString: url });
await client.connect();

if (process.argv.includes('--reset')) {
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('schema dropped');
}
const sql = readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8');
await client.query(sql);
console.log(`migrated ${url}`);
await client.end();
