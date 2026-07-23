import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { actorFrom } from '../auth.js';
import { runWithEvent, entityEvents } from '../lib/mutate.js';
import { parseId, clampInt } from '../lib/validate.js';

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

const patchSchema = z.object({
  name: z.string().nullish(),
  country: z.string().nullish(),
  account_owner_id: z.string().uuid().nullish(),
  // Client specs (migration 009, feedback ⑯) — the desk's guide when sending samples.
  spec_grades: z.string().nullish(),
  spec_cup_profile: z.string().nullish(),
  spec_moisture_max: z.number().nullish(),
  spec_min_score: z.number().nullish(),
  spec_notes: z.string().nullish(),
});

const SORTABLE: Record<string, string> = {
  name: 'c.name',
  country: 'c.country',
  latest_order_date: 'latest_order_date',
};

clients.get('/', h(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const sortKey = SORTABLE[String(req.query.sort)] ?? 'c.name';
  const order = String(req.query.order ?? '').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clampInt(req.query.pageSize, 25, 1, 100);

  const { rows } = await pool.query(
    `SELECT c.*,
       (SELECT count(*)::int FROM client_contacts cc WHERE cc.client_id = c.id) AS contact_count,
       (SELECT max(v.date_on) FROM all_samples_v v WHERE v.client_id = c.id AND v.deleted_at IS NULL) AS latest_order_date,
       count(*) OVER ()::int AS full_count
     FROM clients c
     WHERE c.deleted_at IS NULL AND ($1 = '' OR c.name ILIKE '%' || $1 || '%')
     ORDER BY ${sortKey} ${order} NULLS LAST, c.id ASC
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    [q],
  );
  const total = rows[0]?.full_count ?? 0;
  res.json({ data: rows.map(({ full_count, ...row }) => row), total, page, pageSize });
}));

clients.post('/', h(async (req, res) => {
  const body = parseBody(clientSchema, req.body);
  const existing = await pool.query(`SELECT * FROM clients WHERE lower(name) = lower($1) AND deleted_at IS NULL`, [body.name]);
  if (existing.rows[0]) {
    const client = existing.rows[0];
    if (body.contact) {
      await pool.query(
        `INSERT INTO client_contacts (client_id, attention_to, full_address, phone, email) VALUES ($1, $2, $3, $4, $5)`,
        [client.id, body.contact.attention_to ?? null, body.contact.full_address ?? null, body.contact.phone ?? null, body.contact.email ?? null],
      );
    }
    res.status(200).json(client);
    return;
  }

  const actor = actorFrom(req);
  const client = await runWithEvent(
    `INSERT INTO clients (name, country) VALUES ($1, $2) RETURNING *`,
    [body.name.trim(), body.country ?? null],
    { entityType: 'client', type: 'created', note: `client created: ${body.name.trim()}`, actor },
    body.contact
      ? async (db, row) => {
          await db.query(
            `INSERT INTO client_contacts (client_id, attention_to, full_address, phone, email)
             VALUES ($1, $2, $3, $4, $5)`,
            [row.id, body.contact!.attention_to ?? null, body.contact!.full_address ?? null,
             body.contact!.phone ?? null, body.contact!.email ?? null],
          );
        }
      : undefined,
  );
  res.status(201).json(client);
}));

clients.get('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await pool.query(`SELECT * FROM clients WHERE id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, 'client not found');
  const contacts = await pool.query(`SELECT * FROM client_contacts WHERE client_id = $1 ORDER BY created_at`, [id]);
  const owner = rows[0].account_owner_id
    ? (await pool.query(`SELECT id, name, role, email FROM traders WHERE id = $1`, [rows[0].account_owner_id])).rows[0] ?? null
    : null;
  const orders = await pool.query(
    `SELECT tab, id, ref, title, status, courier_norm, awb, date_on, delivery_on, result_norm,
            blend, strategy, highlights, result_on
     FROM all_samples_v WHERE client_id = $1 AND deleted_at IS NULL
     ORDER BY date_on DESC NULLS LAST LIMIT 200`,
    [id],
  );
  res.json({ ...rows[0], contacts: contacts.rows, account_owner: owner, orders: orders.rows, events: await entityEvents('client', id) });
}));

clients.patch('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const body = parseBody(patchSchema, req.body);
  if (Object.keys(body).length === 0) {
    const { rows } = await pool.query(`SELECT * FROM clients WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!rows[0]) throw new HttpError(404, 'client not found');
    res.json(rows[0]);
    return;
  }
  const actor = actorFrom(req);
  const row = await runWithEvent(
    `UPDATE clients SET
       name = COALESCE($2, name),
       country = COALESCE($3, country),
       account_owner_id = COALESCE($4::uuid, account_owner_id),
       spec_grades = COALESCE($5, spec_grades),
       spec_cup_profile = COALESCE($6, spec_cup_profile),
       spec_moisture_max = COALESCE($7, spec_moisture_max),
       spec_min_score = COALESCE($8, spec_min_score),
       spec_notes = COALESCE($9, spec_notes),
       updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, body.name ?? null, body.country ?? null, body.account_owner_id ?? null,
     body.spec_grades ?? null, body.spec_cup_profile ?? null, body.spec_moisture_max ?? null,
     body.spec_min_score ?? null, body.spec_notes ?? null],
    { entityType: 'client', type: 'edited', note: `fields updated: ${Object.keys(body).join(', ')}`, actor },
  );
  if (!row) throw new HttpError(404, 'client not found');
  res.json(row);
}));

clients.delete('/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const actor = actorFrom(req);
  const row = await runWithEvent(
    `UPDATE clients SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id], { entityType: 'client', type: 'deleted', note: 'soft-deleted', actor },
  );
  if (!row) throw new HttpError(404, 'client not found');
  res.json({ ok: true, id });
}));

clients.post('/:id/contacts', h(async (req, res) => {
  const id = parseId(req.params.id);
  const body = parseBody(contactSchema, req.body);
  const existing = await pool.query(`SELECT 1 FROM clients WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!existing.rows[0]) throw new HttpError(404, 'client not found');
  const { rows } = await pool.query(
    `INSERT INTO client_contacts (client_id, attention_to, full_address, phone, email) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [id, body.attention_to ?? null, body.full_address ?? null, body.phone ?? null, body.email ?? null],
  );
  res.status(201).json(rows[0]);
}));
