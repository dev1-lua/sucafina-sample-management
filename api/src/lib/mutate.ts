import { pool } from '../db.js';

export type EntityType = 'specialty' | 'bulk' | 'forwarding' | 'client';

/**
 * Run one row-change (INSERT/UPDATE `... RETURNING *`) and, if it returns a row,
 * append one polymorphic `events` row for that row's id — in a single transaction.
 * The only sanctioned write path for the new tables (single-writer + audit trail).
 */
export async function runWithEvent(
  sql: string,
  params: unknown[],
  ev: { entityType: EntityType; type: string; note: string | null; actor: string },
  extraWrites?: (client: import('pg').PoolClient, row: Record<string, unknown>) => Promise<void>,
): Promise<Record<string, unknown> | undefined> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(sql, params);
    const row = rows[0];
    if (row) {
      await client.query(
        `INSERT INTO events (entity_type, entity_id, type, note, actor)
         VALUES ($1, $2, $3, $4, $5)`,
        [ev.entityType, row.id, ev.type, ev.note, ev.actor],
      );
    }
    if (row && extraWrites) await extraWrites(client, row);
    await client.query('COMMIT');
    return row;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function entityEvents(entityType: EntityType, id: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT * FROM events WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at`,
    [entityType, id],
  );
  return rows;
}
