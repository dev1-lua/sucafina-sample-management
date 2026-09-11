import type { Pool, PoolClient } from 'pg';
import XLSX from 'xlsx';
import { HttpError } from '../errors.js';
import { normalizeClientName } from './client-merge.js';
import { drawPss, isSettled, loadContractPss, recomputeContractStatus } from './contracts.js';
import { enqueueOutbox } from './notify-outbox.js';
import {
  CANONICAL_FIELDS, detectHeaderRow, dueDateFrom, matchHeaders, monthLabel,
  parseIntCell, parseQtyPerSample, parseShipmentDate, type CanonicalField,
} from './pss-mapping.js';

// The SOL PSS schedule import (phase 5, task 5.4 — Harriet: "feed the PSS table from the SOL report").
// Three steps, deliberately separate: fetch the file, turn it into a PREVIEW nobody can be surprised by,
// and commit that preview. The preview is stored whole in pss_imports.rows, so the commit works from the
// rows a human approved rather than re-reading a file that may have changed underneath us — and so
// re-committing is a no-op instead of a second set of samples.

type Q = Pick<PoolClient, 'query'>;

// ---------------------------------------------------------------------------------------------------
// 1. Fetching the file
// ---------------------------------------------------------------------------------------------------

export type ImportFormat = 'xlsx' | 'csv' | 'pdf';

const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const DEFAULT_HOSTS = ['cdn.heylua.ai'];       // where the Lua channel parks an uploaded attachment
export const PDF_MESSAGE = "PDF isn't supported yet — export the SOL report as Excel or CSV";

const formatFromExt = (ext: string): ImportFormat | null => {
  const e = ext.toLowerCase().replace(/^\./, '');
  if (e === 'xlsx' || e === 'xlsm' || e === 'xls') return 'xlsx';
  if (e === 'csv' || e === 'txt') return 'csv';
  if (e === 'pdf') return 'pdf';
  return null;
};

/** A .xlsx is a zip ("PK"); a PDF says so in its first four bytes; anything else we try to read as text. */
const formatFromBytes = (b: Buffer): ImportFormat => {
  if (b.subarray(0, 2).toString('latin1') === 'PK') return 'xlsx';
  if (b.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  return 'csv';
};

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * https, always — except a loopback host that IMPORT_ALLOWED_HOSTS (or an explicit allowedHosts list)
 * deliberately named, which may be plain http. That is the harness case: a fixture served off
 * 127.0.0.1 has no certificate, and prod never names a loopback host, so nothing is loosened there.
 */
const schemeOk = (u: URL, allowed: string[]): boolean => {
  if (u.protocol === 'https:') return true;
  const host = u.hostname.toLowerCase();
  return u.protocol === 'http:' && LOOPBACK.has(host) && allowed.includes(host);
};

/**
 * Fetch the spreadsheet the agent was handed. This is the one place in the API that follows a URL a
 * user supplied, so it is deliberately narrow: https only (see schemeOk), an allow-listed host (the Lua
 * CDN plus whatever IMPORT_ALLOWED_HOSTS names), 10 MB, 20 seconds. A PDF is refused here with the
 * message that tells Harriet what to send instead — a scanned schedule's numbers are not worth guessing.
 */
export async function downloadImportFile(
  url: string,
  o?: { fetchImpl?: typeof fetch; allowedHosts?: string[] },
): Promise<{ buffer: Buffer; file_name: string; format: ImportFormat }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, `not a URL: ${url}`);
  }
  const allowed = (o?.allowedHosts ?? [
    ...DEFAULT_HOSTS,
    ...(process.env.IMPORT_ALLOWED_HOSTS ?? '').split(','),
  ]).map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!schemeOk(parsed, allowed)) throw new HttpError(400, 'the import file must be served over https');
  if (!allowed.includes(parsed.hostname.toLowerCase())) {
    throw new HttpError(400, `${parsed.hostname} is not an allowed import host`, { allowed });
  }

  const doFetch = o?.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let buffer: Buffer;
  try {
    const res = await doFetch(parsed.toString(), { signal: controller.signal, redirect: 'follow' });
    // A redirect must not walk us off the allow-list: res.url is where we actually ended up.
    if (res.url) {
      const final = new URL(res.url);
      if (!schemeOk(final, allowed) || !allowed.includes(final.hostname.toLowerCase())) {
        throw new HttpError(400, `${final.hostname} is not an allowed import host`, { allowed });
      }
    }
    if (!res.ok) throw new HttpError(502, `could not download the import file (HTTP ${res.status})`);
    // Trust the header when it admits the file is too big — then check what actually arrived, because
    // it may have lied or said nothing at all.
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BYTES) throw new HttpError(413, 'the import file is larger than 10 MB');
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if ((e as Error)?.name === 'AbortError') throw new HttpError(504, 'timed out downloading the import file');
    throw new HttpError(502, `could not download the import file: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  if (buffer.length > MAX_BYTES) throw new HttpError(413, 'the import file is larger than 10 MB');

  const file_name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '') || 'import';
  const ext = parsed.searchParams.get('ext') ?? (file_name.includes('.') ? file_name.split('.').pop()! : '');
  const format = formatFromExt(ext) ?? formatFromBytes(buffer);
  if (format === 'pdf') throw new HttpError(415, PDF_MESSAGE);
  return { buffer, file_name, format };
}

/**
 * Sheet → array of arrays. A CSV must be decoded as UTF-8 TEXT first: handing SheetJS the raw bytes
 * reads them as CP1252 and "Nestlé" arrives as "NestlÃ©", which then fails to match the client book.
 * And its cells must stay TEXT (`raw: true`): left to itself SheetJS guesses at "01/12/2026" and, being
 * US-minded, makes it the 12th of January — Kenya writes day first, and parseShipmentDate knows that.
 * An xlsx keeps its typed cells: a real Excel date arrives as a serial number, which parseShipmentDate
 * reads as the day it is; only typed text goes through the day-first rules.
 */
export function readRows(
  buffer: Buffer,
  format: 'xlsx' | 'csv',
  sheet?: string,
): { sheet: string | null; sheets: string[]; rows: unknown[][] } {
  const wb = format === 'xlsx'
    ? XLSX.read(buffer, { type: 'buffer', cellDates: false })
    : XLSX.read(buffer.toString('utf8'), { type: 'string', raw: true });
  const sheets = wb.SheetNames;
  if (sheets.length === 0) return { sheet: null, sheets, rows: [] };
  if (sheet && !sheets.includes(sheet)) throw new HttpError(400, `no sheet named ${sheet}`, { sheets });
  const name = sheet ?? sheets[0];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null });
  return { sheet: name, sheets, rows };
}

// ---------------------------------------------------------------------------------------------------
// 2. The preview
// ---------------------------------------------------------------------------------------------------

/**
 * The ways the desk writes a client on its own sheets (Harriet's pending-dispatch file): "Zoegas / Nestlé
 * Sverige" (either name), "Nestlé España (Japan destination)" (the destination is not the client),
 * "Marc Bang on behalf of CK CORPORATION" (the client is who it is FOR). The name as written comes first;
 * the book is searched for each variant in turn.
 */
export function clientNameVariants(name: string): string[] {
  const out: string[] = [];
  const push = (v: string) => { const t = v.trim(); if (t && !out.includes(t)) out.push(t); };
  push(name);
  const obo = name.match(/^(.*?)\s+on behalf of\s+(.*)$/i);
  if (obo) { push(obo[2]); push(obo[1]); }
  const noParen = name.replace(/\s*\([^)]*\)\s*/g, ' ');
  if (noParen.trim() !== name.trim()) push(noParen);
  if (/\s\/\s/.test(name)) for (const part of name.split(/\s\/\s/)) push(part);
  return out;
}

export type PreviewRow = {
  row_no: number;                       // 1-based sheet row of the group's FIRST line, as Excel shows it
  contract_number: string | null;
  client_name: string | null;
  client_match: { id: string; name: string; kind: 'exact' | 'fuzzy' } | null;
  quality: string | null;
  destination: string | null;
  shipment_date: string | null;
  date_precision: 'day' | 'month' | null;
  shipment_month: string | null;
  pss_due_date: string | null;
  containers: number;
  pss_expected: number;                 // the number of lettered PSS options (Harriet: free of the container count)
  pss_qty_grams: number | null;         // grams per option, from "Quantity PER SAMPLE"
  po_ref: string | null;
  container_nos: number[];
  notes: string | null;                 // the sheet's remarks column, carried onto the contract on commit
  existing_contract: { id: string; status: string; pss_expected: number } | null;
  action: 'create' | 'update' | 'skip';
  problems: string[];
  warnings: string[];
};

export type PreviewSummary = {
  contracts: number; create: number; update: number; skip: number;
  pss_to_create: number; problems: number; warnings: number; unmatched_clients: string[];
};

export const NEW_CLIENT_WARNING = 'client not in the book — will be created on commit';
/** Why a known contract is left alone (Ivo, 2026-09-10: once the PSS is accepted, no more action). */
const SETTLED_WARNING: Record<string, string> = {
  pss_approved: 'PSS already accepted — nothing more to do on this contract',
  shipped: 'contract already shipped — nothing more to do on it',
  cancelled: 'contract cancelled — the import leaves it as it is',
};

/**
 * Rows → what the import WOULD do, with every doubt written down. Nothing is created here.
 *
 * One contract per `upper(trim(contract_number))`: the SOL export repeats the contract line once per
 * container, so two identical rows are one contract of two containers, not two contracts. A row with no
 * contract number cannot be attached to anything and is kept only so the reader can see it was skipped.
 */
export async function buildPreview(
  db: Q,
  rows: unknown[][],
  o: { mapping?: Partial<Record<CanonicalField, string>>; header_row?: number },
): Promise<{
  detected_mapping: Record<string, string>;
  unmapped_headers: string[];
  header_row: number;
  rows: PreviewRow[];
  summary: PreviewSummary;
}> {
  const headerRow = o.header_row ?? detectHeaderRow(rows);
  if (headerRow < 0 || headerRow >= rows.length) throw new HttpError(422, 'could not find a header row');
  const headers = rows[headerRow] ?? [];
  const { mapping, unmapped } = matchHeaders(headers, o.mapping);
  const detected_mapping: Record<string, string> = {};
  for (const field of CANONICAL_FIELDS) {
    const i = mapping[field];
    if (i !== undefined) detected_mapping[field] = String(headers[i] ?? '').trim();
  }

  const cell = (row: unknown[], field: CanonicalField): unknown => {
    const i = mapping[field];
    return i === undefined ? null : row[i] ?? null;
  };
  const text = (row: unknown[], field: CanonicalField): string | null => {
    const v = cell(row, field);
    if (v == null) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  };

  // Group the data rows, keeping the order they were read in.
  type Group = { key: string | null; row_no: number; lines: unknown[][] };
  const groups: Group[] = [];
  const byKey = new Map<string, Group>();
  for (let i = headerRow + 1; i < rows.length; i++) {
    const line = rows[i] ?? [];
    if (line.every((c) => c == null || String(c).trim() === '')) continue;
    const number = text(line, 'contract_number');
    const key = number ? number.toUpperCase() : null;
    const seen = key ? byKey.get(key) : undefined;
    if (seen) {
      seen.lines.push(line);
      continue;
    }
    const group: Group = { key, row_no: i + 1, lines: [line] };
    groups.push(group);
    if (key) byKey.set(key, group);
  }

  // The client book, and the contracts these numbers already have — two queries, not two per row.
  const { rows: bookRows } = await db.query(`SELECT id, name FROM clients WHERE deleted_at IS NULL ORDER BY name`);
  const book = bookRows.map((c) => ({ id: String(c.id), name: String(c.name), norm: normalizeClientName(String(c.name)) }));
  const keys = groups.map((g) => g.key).filter((k): k is string => k !== null);
  const contractRows = keys.length === 0 ? [] : (await db.query(
    `SELECT id, upper(trim(contract_number)) AS key, status, pss_expected FROM contracts
      WHERE deleted_at IS NULL AND upper(trim(contract_number)) = ANY ($1::text[])`,
    [keys],
  )).rows;
  const existingByKey = new Map<string, { id: string; status: string; pss_expected: number }>(
    contractRows.map((r) => [String(r.key), { id: String(r.id), status: String(r.status), pss_expected: Number(r.pss_expected) }]),
  );
  // Containers that already hold a live PSS — what a re-import must NOT draw again.
  const busyByContract = new Map<string, Set<number>>();
  for (const existing of existingByKey.values()) {
    const live = await loadContractPss(db, existing.id);
    busyByContract.set(existing.id, new Set(live.map((r) => r.container_no).filter((n): n is number => n != null)));
  }

  /** Book match: the same client under a different spelling (exact), or one that merely looks like it. */
  const matchClient = (name: string | null): PreviewRow['client_match'] => {
    if (!name) return null;
    const norms = clientNameVariants(name).map(normalizeClientName).filter((n) => n !== '');
    for (const n of norms) {
      const exact = book.find((c) => c.norm === n);
      if (exact) return { id: exact.id, name: exact.name, kind: 'exact' };
    }
    for (const n of norms) {
      if (n.length < 3) continue;
      // "Gustav Paulig Ltd (NEW) Jan 23" ⊃ "Paulig". The longest candidate wins: it is the most specific.
      const near = book
        .filter((c) => c.norm.length >= 3 && (c.norm.includes(n) || n.includes(c.norm)))
        .sort((a, b) => b.norm.length - a.norm.length || a.name.localeCompare(b.name))[0];
      if (near) return { id: near.id, name: near.name, kind: 'fuzzy' };
    }
    return null;
  };

  const previewRows: PreviewRow[] = groups.map((group) => {
    const first = group.lines[0];
    const problems: string[] = [];
    const warnings: string[] = [];
    const contract_number = text(first, 'contract_number');
    if (!contract_number) problems.push('missing contract number');

    const firstWith = (field: CanonicalField): string | null => {
      for (const line of group.lines) {
        const v = text(line, field);
        if (v) return v;
      }
      return null;
    };

    const rawDate = group.lines.map((l) => cell(l, 'shipment_date')).find((v) => v != null && String(v).trim() !== '') ?? null;
    const parsed = parseShipmentDate(rawDate);
    if (parsed.error) problems.push(parsed.error);

    // A blank — or a nonsense 0 — in either count means "read it off the sheet": one contract line per
    // container is how the SOL export is written, and pss_expected mirrors the containers.
    const containersCell = parseIntCell(cell(first, 'containers'));
    const containers = containersCell !== null && containersCell > 0 ? containersCell : group.lines.length;
    // The options: the PSS column, else "quantity per sample" ("3x600grams" = 3 options), else one per line.
    const qty = group.lines.map((l) => parseQtyPerSample(cell(l, 'qty_per_sample'))).find((q) => q !== null) ?? null;
    const pssCell = parseIntCell(cell(first, 'pss_expected'));
    const listed = [...new Set(
      group.lines.map((l) => parseIntCell(cell(l, 'container_no'))).filter((n): n is number => n != null && n >= 1),
    )].sort((a, b) => a - b);
    const counted = pssCell !== null && pssCell > 0 ? pssCell : qty?.options ?? containers;
    // Every slot the sheet names must be a slot the contract HAS: an option past pss_expected is bucketed
    // nowhere (loadContractPss ignores it, pss_counts never counts it), so the contract could never reach
    // its own count and the 45-day reminder would nag for ever. The sheet's numbering wins.
    const pss_expected = listed.length > 0 ? Math.max(counted, listed[listed.length - 1]) : counted;
    const pss_qty_grams = qty?.grams ?? null;
    const container_nos = listed.length > 0 ? listed : Array.from({ length: Math.max(pss_expected, 0) }, (_, i) => i + 1);

    const existing = group.key ? existingByKey.get(group.key) ?? null : null;
    // A settled contract is shown and skipped: a later export never grows it or draws for it.
    const settled = existing !== null && isSettled(existing.status);
    if (settled) warnings.push(SETTLED_WARNING[existing.status] ?? SETTLED_WARNING.pss_approved);

    const client_name = firstWith('client_name');
    const client_match = matchClient(client_name);
    // Only a row that can actually be imported talks about its client: a line with no contract number
    // (or a settled contract) is going nowhere, and "will be created on commit" would be a lie on it.
    const importable = contract_number !== null && !settled;
    if (importable && client_name && client_match?.kind === 'fuzzy') {
      warnings.push(`client matched loosely to "${client_match.name}" — check before committing`);
    }
    if (importable && client_name && !client_match) warnings.push(NEW_CLIENT_WARNING);

    if (existing && !settled && pss_expected < existing.pss_expected) {
      warnings.push(`contract already expects ${existing.pss_expected} PSS — the sheet's ${pss_expected} is not applied`);
    }

    return {
      row_no: group.row_no,
      contract_number,
      client_name,
      client_match,
      quality: firstWith('quality'),
      destination: firstWith('destination'),
      shipment_date: parsed.date,
      date_precision: parsed.precision,
      shipment_month: parsed.date ? monthLabel(parsed.date) : null,
      pss_due_date: dueDateFrom(parsed.date),
      containers,
      pss_expected,
      pss_qty_grams,
      po_ref: firstWith('po_ref'),
      container_nos,
      notes: firstWith('notes'),
      existing_contract: existing,
      // A row with no contract number, or for a settled contract, is only shown and skipped.
      action: importable ? (existing ? 'update' : 'create') : 'skip',
      problems,
      warnings,
    };
  });

  const toCreate = (r: PreviewRow): number => {
    if (r.problems.length > 0 || r.action === 'skip') return 0;
    const busy = r.existing_contract ? busyByContract.get(r.existing_contract.id) ?? new Set<number>() : new Set<number>();
    return r.container_nos.filter((n) => !busy.has(n)).length;
  };

  const summary: PreviewSummary = {
    contracts: previewRows.filter((r) => r.contract_number !== null).length,
    create: previewRows.filter((r) => r.action === 'create').length,
    update: previewRows.filter((r) => r.action === 'update').length,
    skip: previewRows.filter((r) => r.action === 'skip').length,
    pss_to_create: previewRows.reduce((n, r) => n + toCreate(r), 0),
    problems: previewRows.filter((r) => r.problems.length > 0).length,
    warnings: previewRows.filter((r) => r.warnings.length > 0).length,
    unmatched_clients: [...new Set(
      previewRows.filter((r) => r.action !== 'skip' && r.client_name && !r.client_match).map((r) => r.client_name!),
    )].sort(),
  };

  return { detected_mapping, unmapped_headers: unmapped, header_row: headerRow, rows: previewRows, summary };
}

// ---------------------------------------------------------------------------------------------------
// 3. The commit
// ---------------------------------------------------------------------------------------------------

export type CommitResult = {
  contracts_created: number; contracts_updated: number; pss_created: number;
  skipped: number; contract_ids: string[];
};

/**
 * Turn an approved preview into contracts and PSS requests — ONE transaction, so a schedule half-imported
 * is never a thing that exists. Idempotent twice over: the import row itself may only be committed once
 * (409 after that), and a container that already holds a live PSS is never drawn again, so re-importing
 * the same schedule updates the contracts and creates nothing.
 *
 * Quiet by design: the per-sample 'created' ping stays off (that would be one Teams message per
 * container) and QC gets a single `pss_schedule_imported` row for the whole file.
 */
export async function commitImport(
  pool: Pool,
  importId: string,
  o: { overrides?: { row_no: number; client_id?: string; skip?: boolean }[]; actor: string; actorName: string },
): Promise<CommitResult> {
  const client = await pool.connect();
  let result: CommitResult;
  try {
    await client.query('BEGIN');
    const { rows: locked } = await client.query(`SELECT * FROM pss_imports WHERE id = $1 FOR UPDATE`, [importId]);
    const imp = locked[0];
    if (!imp) throw new HttpError(404, 'import not found');
    if (imp.status !== 'preview') throw new HttpError(409, `import already ${imp.status}`);
    const preview = (imp.rows ?? []) as PreviewRow[];
    if (preview.length === 0 || preview.every((r) => r.problems.length > 0)) {
      throw new HttpError(422, 'every row in this preview has a problem — nothing to commit');
    }

    const overrides = new Map((o.overrides ?? []).map((x) => [x.row_no, x]));
    const stamp = (await client.query(
      `SELECT to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD') AS d`)).rows[0].d as string;
    const comments = `PSS scheduled from SOL import ${stamp}`;
    let contracts_created = 0;
    let contracts_updated = 0;
    let pss_created = 0;
    let skipped = 0;
    const contract_ids: string[] = [];

    for (const row of preview) {
      const override = overrides.get(row.row_no);
      if (override?.skip || row.action === 'skip' || row.problems.length > 0 || !row.contract_number) {
        skipped++;
        continue;
      }

      // --- the contract, locked before anything is written for it: SELECT-then-write (the unique index is
      // partial, so ON CONFLICT cannot see it). One that settled after the preview was taken is left alone.
      const { rows: found } = await client.query(
        `SELECT * FROM contracts WHERE upper(trim(contract_number)) = upper(trim($1)) AND deleted_at IS NULL FOR UPDATE`,
        [row.contract_number]);
      if (found[0] && isSettled(String(found[0].status))) {
        skipped++;
        continue;
      }

      // --- the client: the one the reviewer picked, the one the preview matched, or a new shell -------
      let clientId: string | null = null;
      let clientName: string | null = row.client_name;
      if (override?.client_id) {
        const { rows } = await client.query(
          `SELECT id, name FROM clients WHERE id = $1 AND deleted_at IS NULL`, [override.client_id]);
        if (!rows[0]) throw new HttpError(400, `client not found for row ${row.row_no}`);
        clientId = String(rows[0].id);
        clientName = String(rows[0].name);
      } else if (row.client_match) {
        clientId = row.client_match.id;
        clientName = row.client_match.name;
      } else if (row.client_name) {
        // Same shape as POST /clients: a shell with the destination as its country, and an events row.
        const { rows: already } = await client.query(
          `SELECT id, name FROM clients WHERE lower(name) = lower($1) AND deleted_at IS NULL`, [row.client_name]);
        if (already[0]) {
          clientId = String(already[0].id);
          clientName = String(already[0].name);
        } else {
          const { rows: made } = await client.query(
            `INSERT INTO clients (name, country) VALUES ($1, $2) RETURNING id, name`,
            [row.client_name.trim(), row.destination ?? null]);
          clientId = String(made[0].id);
          clientName = String(made[0].name);
          await client.query(
            `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('client', $1, 'created', $2, $3)`,
            [clientId, `client created: ${clientName} (SOL import)`, o.actor]);
        }
      }

      const args = [
        clientId, clientName, row.quality, row.destination, row.shipment_date, row.shipment_month,
        row.containers, row.pss_expected, row.contract_number.trim(),
      ];
      // Older stored previews (before 021) carry neither field.
      const poRef = row.po_ref ?? null;
      const qtyGrams = row.pss_qty_grams ?? null;
      let contractId: string;
      if (found[0]) {
        contractId = String(found[0].id);
        // A later export only ever adds: it never shrinks a contract and never sets its status by hand
        // (a settled contract was skipped above, so nothing here can reopen it).
        await client.query(
          `UPDATE contracts SET
             client_id      = COALESCE($2::uuid, client_id),
             client_name    = COALESCE($3, client_name),
             quality        = COALESCE($4, quality),
             destination    = COALESCE($5, destination),
             shipment_date  = COALESCE($6::date, shipment_date),
             shipment_month = COALESCE($7, shipment_month),
             containers     = GREATEST(containers, $8::int),
             pss_expected   = GREATEST(pss_expected, $9::int),
             notes          = COALESCE($10, notes),
             import_id      = $11::uuid,
             po_ref         = COALESCE($12, po_ref),
             pss_qty_grams  = COALESCE($13::int, pss_qty_grams),
             updated_at     = now()
           WHERE id = $1`,
          [contractId, ...args.slice(0, 8), row.notes ?? null, importId, poRef, qtyGrams]);
        await client.query(
          `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('contract', $1, 'edited', $2, $3)`,
          [contractId, `updated from SOL import ${imp.file_name ?? ''}`.trim(), o.actor]);
        contracts_updated++;
      } else {
        const { rows: made } = await client.query(
          `INSERT INTO contracts (contract_number, client_id, client_name, quality, destination,
                                  shipment_date, shipment_month, containers, pss_expected, notes,
                                  source, import_id, po_ref, pss_qty_grams)
           VALUES ($9, $1::uuid, $2, $3, $4, $5::date, $6, $7, $8, $10, 'sol_import', $11::uuid, $12, $13::int) RETURNING id`,
          [...args, row.notes ?? null, importId, poRef, qtyGrams]);
        contractId = String(made[0].id);
        await client.query(
          `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('contract', $1, 'created', $2, $3)`,
          [contractId, `contract ${row.contract_number.trim()} imported from the SOL schedule`, o.actor]);
        contracts_created++;
      }

      // --- one PSS per container that has none ------------------------------------------------------
      const busy = new Set((await loadContractPss(client, contractId))
        .map((r) => r.container_no).filter((n): n is number => n != null));
      for (const containerNo of row.container_nos) {
        if (busy.has(containerNo)) continue;
        await drawPss(client, {
          contractId, containerNo, actor: o.actor,
          requestedBy: o.actorName, loggedBy: o.actorName, comments,
        });
        pss_created++;
      }
      await recomputeContractStatus(client, contractId, o.actor);
      contract_ids.push(contractId);
    }

    const { rows: due } = await client.query(
      `SELECT to_char(min(pss_due_date), 'YYYY-MM-DD') AS d FROM contracts WHERE id = ANY ($1::uuid[])`,
      [contract_ids]);
    const first_due = (due[0]?.d as string | null) ?? null;
    const summary = {
      ...(imp.summary ?? {}),
      contracts_created, contracts_updated, pss_created, skipped, first_due,
    };
    await client.query(
      `UPDATE pss_imports SET status = 'committed', committed_at = now(), summary = $2::jsonb, updated_at = now()
        WHERE id = $1`,
      [importId, JSON.stringify(summary)]);
    await client.query(
      `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('import', $1, 'created', $2, $3)`,
      [importId, `committed: ${pss_created} PSS across ${contracts_created + contracts_updated} contracts`, o.actor]);
    // ONE alert for the whole schedule — the per-sample pings stay off (drawPss only speaks up for a
    // replacement), so importing 40 containers is one message to QC, not forty.
    await enqueueOutbox(client, {
      tab: 'import', sampleId: importId, event: 'pss_schedule_imported', recipient: 'qc',
      payload: {
        file_name: imp.file_name, contracts_created, contracts_updated, pss_created,
        first_due, actor: o.actorName,
      },
      actor: o.actor,
    });
    await client.query('COMMIT');
    result = { contracts_created, contracts_updated, pss_created, skipped, contract_ids };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    // A refused import is not a broken connection: only a real fault destroys it.
    client.release(e instanceof HttpError ? undefined : (e as Error));
    throw e;
  }
  client.release();
  return result;
}
