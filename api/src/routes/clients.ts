import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';

export const clients = Router();

const contactSchema = z.object({
  attention_to: z.string().nullish(),
  full_address: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
});

const clientSchema = z.object({
  name: z.string().min(1),
  country: z.string().nullish(),
  contact: contactSchema.nullish(),
});

clients.get('/', h(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const { rows } = await pool.query(
    `SELECT c.*, (SELECT count(*)::int FROM client_contacts cc WHERE cc.client_id = c.id) AS contact_count
     FROM clients c
     WHERE ($1 = '' OR c.name ILIKE '%' || $1 || '%')
     ORDER BY c.name LIMIT 50`,
    [q]
  );
  res.json({ data: rows, total: rows.length });
}));

clients.post('/', h(async (req, res) => {
  const body = parseBody(clientSchema, req.body);
  const existing = await pool.query(`SELECT * FROM clients WHERE lower(name) = lower($1)`, [body.name]);
  let client;
  let created = false;
  if (existing.rows[0]) {
    client = existing.rows[0];
  } else {
    const ins = await pool.query(
      `INSERT INTO clients (name, country) VALUES ($1, $2) RETURNING *`,
      [body.name.trim(), body.country ?? null]
    );
    client = ins.rows[0];
    created = true;
  }
  if (body.contact) {
    await pool.query(
      `INSERT INTO client_contacts (client_id, attention_to, full_address, phone, email)
       VALUES ($1, $2, $3, $4, $5)`,
      [client.id, body.contact.attention_to ?? null, body.contact.full_address ?? null,
       body.contact.phone ?? null, body.contact.email ?? null]
    );
  }
  res.status(created ? 201 : 200).json(client);
}));

clients.get('/:id', h(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM clients WHERE id = $1`, [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'client not found');
  const contacts = await pool.query(
    `SELECT * FROM client_contacts WHERE client_id = $1 ORDER BY created_at`,
    [req.params.id]
  );
  res.json({ ...rows[0], contacts: contacts.rows });
}));

clients.patch('/:id', h(async (req, res) => {
  const body = parseBody(clientSchema.partial(), req.body);
  const { rows } = await pool.query(
    `UPDATE clients SET
       name = COALESCE($2, name),
       country = COALESCE($3, country),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id, body.name ?? null, body.country ?? null]
  );
  if (!rows[0]) throw new HttpError(404, 'client not found');
  res.json(rows[0]);
}));

clients.post('/:id/contacts', h(async (req, res) => {
  const body = parseBody(contactSchema, req.body);
  const { rows } = await pool.query(
    `INSERT INTO client_contacts (client_id, attention_to, full_address, phone, email)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [req.params.id, body.attention_to ?? null, body.full_address ?? null, body.phone ?? null, body.email ?? null]
  );
  res.status(201).json(rows[0]);
}));
