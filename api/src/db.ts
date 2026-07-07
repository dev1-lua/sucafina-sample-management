import pg from 'pg';

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://sucafina:sucafina@localhost:5433/sucafina',
});
