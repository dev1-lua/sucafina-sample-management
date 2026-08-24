import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { parseBody, h } from '../errors.js';
import { parseId } from '../lib/validate.js';

export const traders = Router();

const traderSchema = z.object({
  name: z.string().min(1),
  email: z.string().nullish(),
  role: z.enum(['trader', 'qc']).default('trader'),
  active: z.boolean().default(true),
});

traders.get('/', h(async (req, res) => {
  // ?all=1 includes inactive rows (dashboard Team page); default stays active-only
  // for the agent and the notify jobs.
  const all = req.query.all === '1' || req.query.all === 'true';
  const { rows } = await pool.query(
    all ? `SELECT * FROM traders ORDER BY active DESC, name` : `SELECT * FROM traders WHERE active ORDER BY name`,
  );
  res.json({ data: rows, total: rows.length });
}));

const traderPatchSchema = z
  .object({
    email: z.string().trim().email().nullable(),
    role: z.enum(['trader', 'qc']),
    active: z.boolean(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'nothing to update' });

traders.patch('/:id', h(async (req, res) => {
  const body = parseBody(traderPatchSchema, req.body);
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    vals.push(k === 'email' && typeof v === 'string' ? v.toLowerCase() : v);
    sets.push(`${k} = $${vals.length}`);
  }
  vals.push(parseId(req.params.id));
  const { rows } = await pool.query(
    `UPDATE traders SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
    vals,
  );
  if (!rows[0]) return res.status(404).json({ error: 'trader not found' });
  res.json(rows[0]);
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
