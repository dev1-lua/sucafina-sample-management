import { Router } from 'express';
import { pool } from '../db.js';
import { h } from '../errors.js';
import { StubTrackingProvider } from '../lib/tracking.js';

export const tracking = Router();
const provider = new StubTrackingProvider();

// Interim: await the provider and add rows: []. Fully rebuilt in Task 4.4.
tracking.get('/:awb', h(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT date_on FROM all_samples_v
     WHERE awb = $1 AND deleted_at IS NULL AND status IN ('dispatched','delivered')
     ORDER BY date_on DESC NULLS LAST LIMIT 1`,
    [req.params.awb],
  );
  const dispatchedAt = rows[0]?.date_on ? new Date(rows[0].date_on) : null;
  const info = await provider.track(req.params.awb, dispatchedAt);
  res.json({ ...info, rows: [] });
}));
