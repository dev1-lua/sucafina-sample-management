import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';
import { findRosterExternals, fixRosterExternals } from '../src/lib/roster-externals.js';

// RC7 (2026-09-09): the intake "keep in the loop" question was answered with CUSTOMERS' emails, so
// Nestlé / Itochu contacts sit on the internal roster as "traders" and account managers, receiving
// internal status pings. This is the one-shot clean-up (also usable for any future slip).

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'script:fix-roster-externals');

describe('roster externals clean-up', () => {
  let nestle: string;
  let minette: string;
  let tommie: string;

  beforeAll(async () => {
    minette = (await auth(request(app).post('/traders')).send({ name: 'Minette Rosen', email: 'minette.rosen@se.nestle.com', role: 'trader' })).body.id;
    tommie = (await auth(request(app).post('/traders')).send({ name: 'Tommie Schretlen', email: 'tommie.schretlen@sucafina.com', role: 'trader' })).body.id;
    await auth(request(app).post('/traders')).send({ name: 'Ivo', role: 'trader' }); // no email — must be untouched
    await auth(request(app).post('/traders')).send({ name: 'Dennis', email: 'kenyacof.specialtyqc@sucafina.com', role: 'qc' });
    nestle = (await auth(request(app).post('/clients')).send({ name: 'Nestle', country: 'Sweden' })).body.id;
    await auth(request(app).patch(`/clients/${nestle}`)).send({ account_owner_id: minette });
    const beyers = (await auth(request(app).post('/clients')).send({ name: 'Beyers', country: 'Belgium' })).body.id;
    await auth(request(app).patch(`/clients/${beyers}`)).send({ account_owner_id: tommie });
  });

  it('finds only active roster rows whose email is outside the internal domains', async () => {
    const found = await findRosterExternals(pool);
    expect(found.map((t) => t.name)).toEqual(['Minette Rosen']);
    expect(found[0].clients.map((c) => c.name)).toEqual(['Nestle']);
  });

  it('dry run changes nothing', async () => {
    const report = await fixRosterExternals(pool, { apply: false, actor: 'script:fix-roster-externals' });
    expect(report.found).toHaveLength(1);
    expect(report.applied).toBe(false);
    const c = await auth(request(app).get(`/clients/${nestle}`));
    expect(c.body.account_owner.id).toBe(minette);
  });

  it('apply: unassigns them as account managers, deactivates the roster row, keeps the email on the client', async () => {
    const report = await fixRosterExternals(pool, { apply: true, actor: 'script:fix-roster-externals' });
    expect(report.applied).toBe(true);
    const c = await auth(request(app).get(`/clients/${nestle}`));
    expect(c.body.account_owner).toBeNull();
    expect(c.body.contacts.some((ct: { email: string | null }) => ct.email === 'minette.rosen@se.nestle.com')).toBe(true);
    expect(c.body.events.some((e: { type: string; note: string }) => e.type === 'edited' && /Minette/.test(e.note))).toBe(true);
    const { rows } = await pool.query(`SELECT active FROM traders WHERE id = $1`, [minette]);
    expect(rows[0].active).toBe(false);
    // internal colleague untouched
    const t = await pool.query(`SELECT active FROM traders WHERE id = $1`, [tommie]);
    expect(t.rows[0].active).toBe(true);
    // idempotent
    expect((await findRosterExternals(pool))).toHaveLength(0);
  });
});
