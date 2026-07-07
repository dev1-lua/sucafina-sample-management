import { Router } from 'express';
import { pool } from '../db.js';
import { h } from '../errors.js';
import { StubTrackingProvider } from '../lib/tracking.js';

export const tracking = Router();
const provider = new StubTrackingProvider();

tracking.get('/:awb', h(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT date_on FROM all_samples_v
     WHERE awb = $1 AND deleted_at IS NULL AND status IN ('dispatched','delivered')
     ORDER BY date_on DESC NULLS LAST LIMIT 1`,
    [req.params.awb],
  );
  const dispatchedAt = rows[0]?.date_on ? new Date(rows[0].date_on) : null;
  res.json(provider.track(req.params.awb, dispatchedAt));
}));
