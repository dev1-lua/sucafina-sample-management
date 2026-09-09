import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, reapplyMigrationsFrom, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('migration 018 (legacy samples soft delete)', () => {
  it('adds deleted_at to samples and deleted/restored to event_type_t, idempotently', async () => {
    const sql = readFileSync(fileURLToPath(new URL('../migrations/018_legacy_samples_soft_delete.sql', import.meta.url)), 'utf8');
    await pool.query(sql);
    await reapplyMigrationsFrom('019'); // no-op today; keeps the 011 lesson (helpers.ts) honoured
    const col = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='samples' AND column_name='deleted_at'`);
    expect(col.rowCount).toBe(1);
    const vals = await pool.query(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='event_type_t'`);
    expect(vals.rows.map((r) => r.enumlabel)).toEqual(expect.arrayContaining(['deleted', 'restored']));
  });

  it('GET /samples hides soft-deleted legacy rows', async () => {
    const { rows } = await pool.query(`INSERT INTO samples (ref, quality, requested_at) VALUES ('LEG-1','AB FAQ', now()) RETURNING id`);
    await pool.query(`UPDATE samples SET deleted_at = now() WHERE id = $1`, [rows[0].id]);
    const list = await auth(request(app).get('/samples'));
    expect(list.body.data.find((s: { ref: string }) => s.ref === 'LEG-1')).toBeUndefined(); // legacy list returns { data, total, page, pageSize }
    const one = await auth(request(app).get(`/samples/${rows[0].id}`));
    expect(one.status).toBe(200); // deep links still resolve, like the three books
    await expect(auth(request(app).patch(`/samples/${rows[0].id}`)).send({ comments: 'x' })).resolves.toMatchObject({ status: 404 });
  });
});
