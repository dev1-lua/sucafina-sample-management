import { describe, it, expect, beforeAll } from 'vitest';
import { resetDb } from './helpers.js';
import { pool } from '../src/db.js';
import { buildList, makeFilters } from '../src/lib/list.js';
import { runWithEvent, entityEvents } from '../src/lib/mutate.js';
import { parseId } from '../src/lib/validate.js';
import { HttpError } from '../src/errors.js';

beforeAll(resetDb);

const insertSpecialty = (description: string) =>
  pool.query(
    `INSERT INTO specialty_samples (description, receiver_company, status)
     VALUES ($1, 'Beyers', 'requested') RETURNING id`,
    [description],
  );

describe('parseId', () => {
  it('returns a valid uuid', () => {
    expect(parseId('00000000-0000-0000-0000-000000000000')).toBe('00000000-0000-0000-0000-000000000000');
  });
  it('throws 400 on garbage', () => {
    expect(() => parseId('not-a-uuid')).toThrow(HttpError);
  });
});

describe('buildList', () => {
  it('paginates and reports the true total via count(*) OVER ()', async () => {
    for (let i = 0; i < 3; i++) await insertSpecialty(`Q${i}`);
    const f = makeFilters();
    const res = await buildList(
      { table: 'specialty_samples', sortable: ['created_at', 'description'], defaultSort: 'created_at', searchColumns: ['description'] },
      { pageSize: '2' }, f.where, f.params,
    );
    expect(res.data).toHaveLength(2);
    expect(res.total).toBe(3);
    expect(res.pageSize).toBe(2);
  });

  it('search matches on the whitelisted columns', async () => {
    const f = makeFilters();
    const res = await buildList(
      { table: 'specialty_samples', sortable: ['created_at'], defaultSort: 'created_at', searchColumns: ['description'] },
      { q: 'Q1' }, f.where, f.params,
    );
    expect(res.total).toBe(1);
    expect(res.data[0].description).toBe('Q1');
  });

  it('an unwhitelisted sort falls back to the default (no SQL error)', async () => {
    const f = makeFilters();
    const res = await buildList(
      { table: 'specialty_samples', sortable: ['created_at'], defaultSort: 'created_at' },
      { sort: 'description; DROP TABLE specialty_samples' }, f.where, f.params,
    );
    expect(res.total).toBe(3); // table intact, injection ignored
  });

  it('excludes soft-deleted rows by default', async () => {
    await pool.query(`UPDATE specialty_samples SET deleted_at = now() WHERE description = 'Q0'`);
    const f = makeFilters();
    const res = await buildList(
      { table: 'specialty_samples', sortable: ['created_at'], defaultSort: 'created_at' },
      {}, f.where, f.params,
    );
    expect(res.total).toBe(2);
  });

  it('does not mutate the caller-owned params array (a ?q= search push stays local)', async () => {
    const f = makeFilters();
    f.add(`description LIKE ?`, '%Q%');
    const paramsBefore = [...f.params];
    await buildList(
      { table: 'specialty_samples', sortable: ['created_at'], defaultSort: 'created_at', searchColumns: ['description'] },
      { q: 'Q1' }, f.where, f.params,
    );
    expect(f.params).toEqual(paramsBefore); // buildList must copy, not push into, the caller's array
  });

  it('falls back to the default page/pageSize on non-numeric pagination params (no NaN LIMIT)', async () => {
    const f = makeFilters();
    const res = await buildList(
      { table: 'specialty_samples', sortable: ['created_at'], defaultSort: 'created_at' },
      { page: 'abc', pageSize: 'abc' }, f.where, f.params,
    );
    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(25);
  });
});

describe('runWithEvent', () => {
  it('writes the row and one event atomically', async () => {
    const row = await runWithEvent(
      `INSERT INTO bulk_samples (quality, client, status) VALUES ('AB','X','requested') RETURNING *`,
      [], { entityType: 'bulk', type: 'created', note: 'seed', actor: 'test' },
    );
    expect(row).toBeDefined();
    const evs = await entityEvents('bulk', row!.id as string);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ type: 'created', actor: 'test', entity_type: 'bulk' });
  });

  it('rolls back the row when the event insert fails', async () => {
    const before = await pool.query(`SELECT count(*)::int n FROM bulk_samples`);
    await expect(runWithEvent(
      `INSERT INTO bulk_samples (quality, status) VALUES ('ROLLBACK','requested') RETURNING *`,
      [], { entityType: 'bulk', type: 'not_a_valid_event' as never, note: null, actor: 'test' },
    )).rejects.toThrow();
    const after = await pool.query(`SELECT count(*)::int n FROM bulk_samples`);
    expect(after.rows[0].n).toBe(before.rows[0].n); // no orphan row
  });
});
