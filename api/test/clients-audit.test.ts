import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';
import { pool } from '../src/db.js';
import { runWithEvent } from '../src/lib/mutate.js';

beforeAll(resetDb);

const auth = (r: request.Test) => r.set('x-api-key', API_KEY);

// Fix-Task A (finding I1): POST /clients create must go through runWithEvent so the
// client row and its `created` event land in one transaction (single-writer / audit trail).
describe('clients create — audit trail (I1)', () => {
  it('writes exactly one created event, with the x-actor actor, visible on GET /clients/:id', async () => {
    const res = await auth(request(app).post('/clients'))
      .set('x-actor', 'dashboard')
      .send({ name: 'Audit Trail Coffee Co' });
    expect(res.status).toBe(201);
    const id = res.body.id;

    const got = await auth(request(app).get(`/clients/${id}`));
    expect(got.status).toBe(200);
    expect(got.body.events).toHaveLength(1);
    expect(got.body.events[0]).toMatchObject({
      type: 'created',
      entity_type: 'client',
      actor: 'dashboard',
    });
  });

  // client_contacts (001_init.sql) has no NOT NULL/length constraint reachable through the
  // public API's contact fields (all nullable text) other than client_id, which the route
  // always supplies correctly — so there's no clean way to force the inline-contact insert
  // to fail via the public HTTP API. Per the brief, drive runWithEvent directly (mirroring
  // lib.test.ts's "rolls back the row when the event insert fails" pattern) with an
  // extraWrites hook that throws, and assert the primary INSERT rolled back.
  it('rolls back the client row and the created event when extraWrites throws inside the transaction', async () => {
    const before = await pool.query(`SELECT count(*)::int n FROM clients`);

    await expect(
      runWithEvent(
        `INSERT INTO clients (name, country) VALUES ($1, $2) RETURNING *`,
        ['Rollback Test Co', null],
        { entityType: 'client', type: 'created', note: 'rollback test', actor: 'test' },
        async () => {
          throw new Error('forced extraWrites failure');
        },
      ),
    ).rejects.toThrow('forced extraWrites failure');

    const after = await pool.query(`SELECT count(*)::int n FROM clients`);
    expect(after.rows[0].n).toBe(before.rows[0].n);

    const found = await pool.query(
      `SELECT 1 FROM clients WHERE lower(name) = lower('Rollback Test Co')`,
    );
    expect(found.rows).toHaveLength(0);
  });
});
