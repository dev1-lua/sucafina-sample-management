import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { actorFrom } from '../auth.js';
import { parseId } from '../lib/validate.js';
import { CANONICAL_FIELDS, type CanonicalField } from '../lib/pss-mapping.js';
import { buildPreview, commitImport, downloadImportFile, readRows } from '../lib/pss-import.js';

export const imports = Router();

// The SOL PSS schedule import (phase 5, task 5.4). Two steps on purpose: POST the file's URL to SEE what
// it would do, then POST the commit to let it. HTTP only lives here — the reading, the mapping and the
// writing are in lib/pss-import.ts and lib/pss-mapping.ts.

const previewSchema = z.object({
  file_url: z.string().min(1),
  sheet: z.string().nullish(),
  // { canonical field: the header it lives under } — how a human corrects a column we mapped wrongly.
  mapping: z.record(z.string()).nullish(),
  header_row: z.number().int().min(0).max(999).nullish(),
});

const commitSchema = z.object({
  overrides: z.array(z.object({
    row_no: z.number().int().min(1),
    client_id: z.string().uuid().nullish(),
    skip: z.boolean().nullish(),
  })).max(500).nullish(),
});

/** 'dashboard:Ivo' / 'agent:Harriet' → 'Ivo' / 'Harriet'; a bare actor is already the name. */
const nameOf = (actor: string): string => actor.replace(/^(dashboard|agent):/, '').trim() || actor;

imports.post('/pss-schedule', h(async (req, res) => {
  const body = parseBody(previewSchema, req.body);
  const actor = actorFrom(req);
  const mapping: Partial<Record<CanonicalField, string>> = {};
  for (const [field, header] of Object.entries(body.mapping ?? {})) {
    if (!(CANONICAL_FIELDS as readonly string[]).includes(field)) {
      throw new HttpError(400, `unknown field in mapping: ${field}`, { fields: CANONICAL_FIELDS });
    }
    mapping[field as CanonicalField] = header;
  }

  const file = await downloadImportFile(body.file_url);
  const { sheet, sheets, rows } = readRows(file.buffer, file.format as 'xlsx' | 'csv', body.sheet ?? undefined);
  const preview = await buildPreview(pool, rows, {
    mapping: Object.keys(mapping).length > 0 ? mapping : undefined,
    header_row: body.header_row ?? undefined,
  });

  const { rows: saved } = await pool.query(
    `INSERT INTO pss_imports (file_url, file_name, format, sheet, mapping, rows, summary, actor)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8) RETURNING id`,
    [body.file_url, file.file_name, file.format, sheet,
     JSON.stringify({
       requested: mapping, detected: preview.detected_mapping,
       unmapped_headers: preview.unmapped_headers, header_row: preview.header_row, sheets,
     }),
     JSON.stringify(preview.rows), JSON.stringify(preview.summary), actor],
  );
  res.json({
    import_id: String(saved[0].id),
    file_name: file.file_name,
    format: file.format,
    sheet, sheets,
    header_row: preview.header_row,
    detected_mapping: preview.detected_mapping,
    unmapped_headers: preview.unmapped_headers,
    rows: preview.rows,
    summary: preview.summary,
  });
}));

imports.get('/pss-schedule/:id', h(async (req, res) => {
  const id = parseId(req.params.id);
  const { rows } = await pool.query(`SELECT * FROM pss_imports WHERE id = $1`, [id]);
  const imp = rows[0];
  if (!imp) throw new HttpError(404, 'import not found');
  const stored = (imp.mapping ?? {}) as Record<string, unknown>;
  res.json({
    import_id: String(imp.id),
    file_name: imp.file_name,
    file_url: imp.file_url,
    format: imp.format,
    sheet: imp.sheet,
    sheets: stored.sheets ?? [],
    header_row: stored.header_row ?? null,
    detected_mapping: stored.detected ?? {},
    unmapped_headers: stored.unmapped_headers ?? [],
    status: imp.status,
    actor: imp.actor,
    committed_at: imp.committed_at,
    created_at: imp.created_at,
    rows: imp.rows ?? [],
    summary: imp.summary,
  });
}));

imports.post('/pss-schedule/:id/commit', h(async (req, res) => {
  const id = parseId(req.params.id);
  const body = parseBody(commitSchema, req.body);
  const actor = actorFrom(req);
  const result = await commitImport(pool, id, {
    overrides: (body.overrides ?? []).map((o) => ({
      row_no: o.row_no, client_id: o.client_id ?? undefined, skip: o.skip ?? undefined,
    })),
    actor,
    actorName: nameOf(actor),
  });
  res.json(result);
}));
