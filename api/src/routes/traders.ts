import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { parseBody, h } from '../errors.js';

export const traders = Router();

const traderSchema = z.object({
  name: z.string().min(1),
  email: z.string().nullish(),
  role: z.enum(['trader', 'qc']).default('trader'),
  active: z.boolean().default(true),
});

traders.get('/', h(async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM traders WHERE active ORDER BY name`);
  res.json({ data: rows, total: rows.length });
}));

traders.post('/', h(async (req, res) => {
  const body = parseBody(traderSchema, req.body);
  const existing = await pool.query(`SELECT 1 FROM traders WHERE name = $1`, [body.name]);
  const { rows } = await pool.query(
    `INSERT INTO traders (name, email, role, active) VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role, active = EXCLUDED.active
     RETURNING *`,
    [body.name.trim(), body.email ?? null, body.role, body.active],
  );
  res.status(existing.rows[0] ? 200 : 201).json(rows[0]);
}));
