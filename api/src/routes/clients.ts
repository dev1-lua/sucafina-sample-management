import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { actorFrom } from '../auth.js';
import { runWithEvent, entityEvents } from '../lib/mutate.js';
import { parseId, clampInt } from '../lib/validate.js';
import { normalizeClientName, isInternalOffice } from '../lib/client-merge.js';

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
  // Migration 010: per-client phyto-cert default — sample creation falls back to it.
  default_phyto_cert: z.string().nullish(),
});

type ContactInput = z.infer<typeof contactSchema>;

/**
 * Add a contact to a client WITHOUT creating a duplicate person: if a contact row already matches on
 * attention_to (case-insensitive), phone, or email, fill in that row's empty fields instead of
 * inserting a second row. (Folgers, 2026-07-24: "update the address" produced two rows for the same
 * contact — one with the phone, one with the address.) Returns the resulting contact row.
 */
export async function upsertContact(db: { query: typeof pool.query }, clientId: string, c: ContactInput) {
  const attention = c.attention_to?.trim() || null;
  const address = c.full_address?.trim() || null;
  const phone = c.phone?.trim() || null;
  const email = c.email?.trim() || null;
  const match = await db.query(
    `SELECT id FROM client_contacts
      WHERE client_id = $1
        AND (($2::text IS NOT NULL AND lower(attention_to) = lower($2))
          OR ($3::text IS NOT NULL AND phone = $3)
          OR ($4::text IS NOT NULL AND lower(email) = lower($4)))
      ORDER BY created_at ASC LIMIT 1`,
    [clientId, attention, phone, email],
  );
  if (match.rows[0]) {
    const { rows } = await db.query(
      `UPDATE client_contacts SET
         attention_to = COALESCE(attention_to, $2),
         full_address = COALESCE($3, full_address),
         phone        = COALESCE(phone, $4),
         email        = COALESCE(email, $5)
       WHERE id = $1 RETURNING *`,
      [match.rows[0].id, attention, address, phone, email],
    );
    return rows[0];
  }
  const { rows } = await db.query(
    `INSERT INTO client_contacts (client_id, attention_to, full_address, phone, email)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [clientId, attention, address, phone, email],
  );
  return rows[0];
}

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
    let client = existing.rows[0];
    if (body.contact) await upsertContact(pool, client.id, body.contact);
    // Backfill country when the book had none (never overwrite a country already on file).
    if (body.country && !client.country) {
      const { rows } = await pool.query(
        `UPDATE clients SET country = $2, updated_at = now() WHERE id = $1 RETURNING *`,
        [client.id, body.country],
      );
      client = rows[0] ?? client;
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
       default_phyto_cert = COALESCE($10, default_phyto_cert),
       updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, body.name ?? null, body.country ?? null, body.account_owner_id ?? null,
     body.spec_grades ?? null, body.spec_cup_profile ?? null, body.spec_moisture_max ?? null,
     body.spec_min_score ?? null, body.spec_notes ?? null, body.default_phyto_cert ?? null],
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
  const row = await upsertContact(pool, id, body);
  res.status(201).json(row);
}));

// ---------------------------------------------------------------------------------------------------
// Merge duplicate clients (feedback #27 — Sam, 2026-07-24: "Paulig" + "Gustav Paulig Ltd (NEW) Jan 23"
// are the same company; "merge them together"). Sources fold INTO the target inside one transaction:
// sample rows re-pointed (all four tables), contacts folded via upsertContact (no duplicate people),
// target's empty fields filled from the sources, sources soft-deleted with an audit trail on both sides.
// ---------------------------------------------------------------------------------------------------

const mergeSchema = z.object({
  source_ids: z.array(z.string().uuid()).max(50),
  name: z.string().trim().min(1).nullish(),
});

/** Whole-word containment either way: "paulig" ⊂ "gustav paulig". */
function normalizedNamesRelate(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const pa = ` ${a} `; const pb = ` ${b} `;
  return pa.includes(pb) || pb.includes(pa);
}

clients.get('/:id/merge-candidates', h(async (req, res) => {
  const id = parseId(req.params.id);
  const me = await pool.query(`SELECT id, name FROM clients WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!me.rows[0]) throw new HttpError(404, 'client not found');
  const normalized = normalizeClientName(me.rows[0].name);
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.country,
       (SELECT count(*)::int FROM client_contacts cc WHERE cc.client_id = c.id) AS contact_count,
       (SELECT count(*)::int FROM all_samples_v v WHERE v.client_id = c.id AND v.deleted_at IS NULL) AS sample_count,
       EXISTS (SELECT 1 FROM client_contacts cc WHERE cc.client_id = c.id AND coalesce(trim(cc.full_address), '') <> '') AS has_address
     FROM clients c WHERE c.deleted_at IS NULL AND c.id <> $1 ORDER BY c.name`,
    [id],
  );
  const data = rows.filter((c) => normalizedNamesRelate(normalized, normalizeClientName(c.name)));
  res.json({ normalized, data });
}));

clients.post('/:id/merge', h(async (req, res) => {
  const targetId = parseId(req.params.id);
  const body = parseBody(mergeSchema, req.body);
  const sourceIds = [...new Set(body.source_ids)];
  if (sourceIds.includes(targetId)) throw new HttpError(400, 'target cannot be one of the sources');
  const actor = actorFrom(req);

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const t = await db.query(`SELECT * FROM clients WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [targetId]);
    const target = t.rows[0];
    if (!target) throw new HttpError(404, 'target client not found');
    const s = sourceIds.length
      ? await db.query(`SELECT * FROM clients WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL FOR UPDATE`, [sourceIds])
      : { rows: [] as any[] };
    const found = new Set(s.rows.map((r) => r.id));
    const missing = sourceIds.filter((x) => !found.has(x));
    if (missing.length) throw new HttpError(404, `source client not found or already merged: ${missing.join(', ')}`);
    const sources: any[] = sourceIds.map((x) => s.rows.find((r) => r.id === x));

    const targetInternal = isInternalOffice(target.name);
    for (const src of sources) {
      if (isInternalOffice(src.name) !== targetInternal) {
        throw new HttpError(400, `refusing to merge an internal Sucafina office with an external client (${src.name} → ${target.name})`);
      }
    }

    const finalName: string = body.name ?? target.name;
    if (body.name && body.name.toLowerCase() !== String(target.name).toLowerCase()) {
      const live = await db.query(
        `SELECT id, name FROM clients WHERE lower(name) = lower($1) AND deleted_at IS NULL AND id <> $2`, [body.name, targetId]);
      if (live.rows[0]) throw new HttpError(409, `another client already uses the name "${live.rows[0].name}" — merge it too or pick a different name`);
    }

    // 1. Re-point sample rows; rewrite the free-text receiver only where it equalled the source's name.
    const repointed = { specialty: 0, bulk: 0, forwarding: 0, legacy: 0 };
    const tables: Array<[keyof typeof repointed, string, string]> = [
      ['specialty', 'specialty_samples', 'receiver_company'],
      ['bulk', 'bulk_samples', 'client'],
      ['forwarding', 'forwarding_samples', 'receiver_company'],
      ['legacy', 'samples', 'receiver'],
    ];
    for (const src of sources) {
      for (const [key, table, col] of tables) {
        const r = await db.query(
          `UPDATE ${table} SET client_id = $1,
             ${col} = CASE WHEN lower(trim(coalesce(${col}, ''))) = lower(trim($3)) THEN $4 ELSE ${col} END
           WHERE client_id = $2`,
          [targetId, src.id, src.name, finalName],
        );
        repointed[key] += r.rowCount ?? 0;
      }
    }

    // 2. Fold contacts (upsertContact merges the same person by name/phone/email), then drop the source rows.
    let contactsFolded = 0;
    for (const src of sources) {
      const cs = await db.query(`SELECT * FROM client_contacts WHERE client_id = $1 ORDER BY created_at`, [src.id]);
      for (const c of cs.rows) {
        await upsertContact(db, targetId, c);
        contactsFolded += 1;
      }
      await db.query(`DELETE FROM client_contacts WHERE client_id = $1`, [src.id]);
    }

    // 3. Fill the target's empty fields from the sources (first non-null wins, in the given order).
    const fill: Record<string, unknown> = {};
    for (const f of ['country', 'account_owner_id', 'spec_grades', 'spec_cup_profile', 'spec_moisture_max', 'spec_min_score', 'spec_notes', 'default_phyto_cert']) {
      if (target[f] == null) {
        const donor = sources.find((x) => x[f] != null);
        if (donor) fill[f] = donor[f];
      }
    }

    // 4. Soft-delete sources with a merged_into event each.
    for (const src of sources) {
      await db.query(`UPDATE clients SET deleted_at = now(), updated_at = now() WHERE id = $1`, [src.id]);
      await db.query(
        `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('client', $1, 'merged_into', $2, $3)`,
        [src.id, `merged into ${targetId} (${finalName})`, actor],
      );
    }

    // 5. Rename: soft-deleted rows (incl. the sources just folded) still hold their names under the
    //    case-insensitive unique index — move them aside as "<name> (merged <shortid>)" first.
    if (finalName !== target.name) {
      const ghosts = await db.query(
        `SELECT id, name FROM clients WHERE lower(name) = lower($1) AND deleted_at IS NOT NULL AND id <> $2`, [finalName, targetId]);
      for (const g of ghosts.rows) {
        await db.query(`UPDATE clients SET name = $2 WHERE id = $1`, [g.id, `${g.name} (merged ${String(g.id).slice(0, 8)})`]);
      }
    }
    const setCols = ['name = $2', 'updated_at = now()'];
    const params: unknown[] = [targetId, finalName];
    for (const [k, v] of Object.entries(fill)) { params.push(v); setCols.push(`${k} = $${params.length}`); }
    const updated = await db.query(`UPDATE clients SET ${setCols.join(', ')} WHERE id = $1 RETURNING *`, params);

    // 6. One merged event on the target listing sources + counts.
    const merged = sources.map((x) => ({ id: x.id, name: x.name }));
    const note = [
      merged.length ? `merged ${merged.map((m) => `${m.name} (${m.id})`).join(', ')}` : 'no sources',
      `repointed specialty ${repointed.specialty}, bulk ${repointed.bulk}, forwarding ${repointed.forwarding}, legacy ${repointed.legacy}`,
      `contacts folded ${contactsFolded}`,
      finalName !== target.name ? `renamed "${target.name}" → "${finalName}"` : null,
      Object.keys(fill).length ? `filled ${Object.keys(fill).join(', ')}` : null,
    ].filter(Boolean).join('; ');
    await db.query(
      `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('client', $1, 'merged', $2, $3)`,
      [targetId, note, actor],
    );

    await db.query('COMMIT');
    db.release();
    res.json({ target: updated.rows[0], merged, repointed, contacts_folded: contactsFolded });
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    db.release(e instanceof HttpError ? undefined : (e as Error));
    throw e;
  }
}));
