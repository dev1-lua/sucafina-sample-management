import { pool } from '../db.js';

export async function addEvent(sampleId: string, type: string, note: string, actor: string) {
  await pool.query(
    `INSERT INTO sample_events (sample_id, type, note, actor) VALUES ($1, $2, $3, $4)`,
    [sampleId, type, note, actor]
  );
}
