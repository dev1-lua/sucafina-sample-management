import { Router } from 'express';
import { pool } from '../db.js';
import { h } from '../errors.js';
import { StubTrackingProvider } from '../lib/tracking.js';

export const tracking = Router();
const provider = new StubTrackingProvider();

tracking.get('/:awb', h(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT dispatched_at FROM samples WHERE awb = $1 ORDER BY dispatched_at DESC NULLS LAST LIMIT 1`,
    [req.params.awb]
  );
  const dispatchedAt = rows[0]?.dispatched_at ? new Date(rows[0].dispatched_at) : null;
  res.json(provider.track(req.params.awb, dispatchedAt));
}));
