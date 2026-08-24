import pg from 'pg';

// Return DATE columns as plain 'YYYY-MM-DD' strings instead of local-midnight Date
// objects — JSON then carries the calendar date itself, immune to the server's
// timezone (a Date would serialize 2026-08-20 as 2026-08-19T18:30Z on an IST host).
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ?? 'postgres://sucafina:sucafina@localhost:5433/sucafina',
});
