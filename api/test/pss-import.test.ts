import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import XLSX from 'xlsx';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';
import {
  CANONICAL_FIELDS, DEFAULT_SYNONYMS, normHeader, matchHeaders, detectHeaderRow,
  parseShipmentDate, parseIntCell,
} from '../src/lib/pss-mapping.js';
import { downloadImportFile, readRows } from '../src/lib/pss-import.js';

// Phase 5, task 5.4 — the SOL PSS schedule import. Harriet mails a spreadsheet of contracts; the agent
// (or the dashboard) hands us its URL, we map the headers, show a preview, and on commit create the
// contracts plus one PSS request per container. Committing the same schedule twice must create nothing.

type Row = Record<string, any>;
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'dashboard:Ivo');

// ---------------------------------------------------------------------------------------------------
// The fixture, and the xlsx built from the very same rows (no binary in a public repo).
// ---------------------------------------------------------------------------------------------------
const csvBytes = readFileSync(new URL('./fixtures/sol-pss.csv', import.meta.url));
// `raw: true` keeps the cells as typed, the way readRows reads a CSV — otherwise this fixture would carry
// SheetJS's US-first guess at "01/12/2026" and the "identical preview" scenario would compare two bugs.
const csvRows = XLSX.utils.sheet_to_json<unknown[]>(
  XLSX.read(csvBytes.toString('utf8'), { type: 'string', raw: true }).Sheets.Sheet1,
  { header: 1, raw: true, defval: null },
);
const xlsxBytes = (() => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(csvRows), 'SOL');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
})();

const csvText = (lines: string[]) => lines.join('\n');
const EXTRA_CSV = csvText([
  'Contract No,Buyer,Quality,Destination,Shipment,Ctrs,PSS',
  'CT-2026-20,Kaldi Coffee Roasters,AB FAQ,Kenya,15/10/2026,1,1',
  'CT-2026-21,Bean There Trading,AA,Germany,15/10/2026,1,1',
]);
const ALL_BAD_CSV = csvText([
  'Contract No,Buyer,Quality,Destination,Shipment',
  ',No Contract Here,AB,Kenya,15/10/2026',
]);
const NO_HEADER_CSV = csvText(['alpha,beta,gamma', '1,2,3']);
// Day <= 12: ambiguous to a US-first reader. Kenya writes dd/mm — 01/12/2026 is the 1st of December.
const DDMM_CSV = csvText([
  'Contract No,Buyer,Quality,Destination,Shipment,Ctrs,PSS',
  'CT-2026-40,Paulig,AB FAQ,Finland,01/12/2026,1,1',
  'CT-2026-41,Paulig,AB FAQ,Finland,3/4/2027,1,1',
]);
// The same dates as REAL Excel date cells (what a saved .xlsx from SOL actually holds).
const DATE_CELL_XLSX = (() => {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Contract No', 'Buyer', 'Quality', 'Destination', 'Shipment', 'Ctrs', 'PSS'],
    ['CT-2026-42', 'Paulig', 'AB FAQ', 'Finland', new Date(2026, 11, 1), 1, 1],
  ], { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SOL');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer;
})();
const ZEROES_CSV = csvText([
  'Contract No,Buyer,Quality,Destination,Shipment,Ctrs,PSS',
  'CT-2026-30,Paulig,AB FAQ,Finland,20/10/2026,0,0',
]);

const HOST = 'https://cdn.heylua.ai/uploads';
const FILES: Record<string, { body: Buffer | string; status?: number; headers?: Record<string, string> }> = {
  [`${HOST}/sol-pss.csv`]: { body: csvBytes },
  [`${HOST}/sol-pss.xlsx`]: { body: xlsxBytes },
  [`${HOST}/sol-extra.csv`]: { body: EXTRA_CSV },
  [`${HOST}/sol-bad.csv`]: { body: ALL_BAD_CSV },
  [`${HOST}/sol-noheader.csv`]: { body: NO_HEADER_CSV },
  [`${HOST}/sol-zeroes.csv`]: { body: ZEROES_CSV },
  [`${HOST}/sol-ddmm.csv`]: { body: DDMM_CSV },
  [`${HOST}/sol-datecell.xlsx`]: { body: DATE_CELL_XLSX },
  [`${HOST}/sol.pdf`]: { body: Buffer.from('%PDF-1.4 not a spreadsheet') },
  [`${HOST}/gone.csv`]: { body: 'nope', status: 404 },
  [`${HOST}/huge.csv`]: { body: 'small body, big claim', headers: { 'content-length': '20000000' } },
  'https://evil.example/x.csv': { body: 'forbidden', status: 403 },
};

const stubFetch = () => {
  const impl = vi.fn(async (input: unknown) => {
    const url = String(input);
    const file = FILES[url.split('?')[0]] ?? FILES[url];
    if (!file) return new Response('not stubbed', { status: 404 });
    return new Response(file.body as BodyInit, { status: file.status ?? 200, headers: file.headers });
  });
  vi.stubGlobal('fetch', impl);
  return impl;
};

beforeAll(async () => {
  await resetDb();
});
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------------------------------
// Header mapping and cell parsing — pure, no database.
// ---------------------------------------------------------------------------------------------------

describe('pss-mapping', () => {
  it('normalises headers: case, punctuation, underscores, spacing', () => {
    expect(normHeader('Contract #')).toBe('contract');
    expect(normHeader('  PSS_qty  ')).toBe('pss qty');
    expect(normHeader('No. of Containers')).toBe('no of containers');
    expect(normHeader(null)).toBe('');
    expect(normHeader(42)).toBe('42');
  });

  it('every canonical field has synonyms, and no two fields claim the same one', () => {
    // "contract" and "contract #" normalise onto the same text, which is fine — they are the same field.
    // Two DIFFERENT fields claiming one header would make the mapping depend on field order.
    const seen = new Map<string, string>();
    for (const field of CANONICAL_FIELDS) {
      expect(DEFAULT_SYNONYMS[field].length).toBeGreaterThan(0);
      for (const syn of DEFAULT_SYNONYMS[field]) {
        const n = normHeader(syn);
        expect(seen.get(n) ?? field).toBe(field);
        seen.set(n, field);
      }
    }
  });

  it("maps the SOL sheet's seven headers, including Ctrs and Shipment", () => {
    const { mapping, unmapped } = matchHeaders(csvRows[2]);
    expect(mapping).toEqual({
      contract_number: 0, client_name: 1, quality: 2, destination: 3,
      shipment_date: 4, containers: 5, pss_expected: 6,
    });
    expect(unmapped).toEqual([]);
  });

  it('falls back to token overlap, and leaves a header nobody claims unmapped', () => {
    const { mapping, unmapped } = matchHeaders(['Shipment Period 2026', 'Contract No', 'Vessel ETA berth']);
    expect(mapping.shipment_date).toBe(0);          // {shipment,period,2026} ∩ {shipment,period} = 2/3
    expect(mapping.contract_number).toBe(1);
    expect(unmapped).toEqual(['Vessel ETA berth']);
  });

  it('a caller override beats the synonym table', () => {
    // "Mark" is a `quality` synonym; the caller says that column is really the notes column.
    const { mapping } = matchHeaders(['Contract No', 'Mark', 'Quality'], { notes: 'Mark' });
    expect(mapping.notes).toBe(1);
    expect(mapping.quality).toBe(2);
  });

  it('finds the header row under two banner rows, and reports -1 when there is none', () => {
    expect(detectHeaderRow(csvRows)).toBe(2);
    expect(detectHeaderRow([['alpha', 'beta', 'gamma'], [1, 2, 3]])).toBe(-1);
  });

  it('parses every shipment-date shape the SOL sheet uses', () => {
    expect(parseShipmentDate(46315)).toEqual({ date: '2026-10-20', precision: 'day' });         // Excel serial
    expect(parseShipmentDate(new Date(2026, 9, 20))).toEqual({ date: '2026-10-20', precision: 'day' });
    expect(parseShipmentDate('20/10/2026')).toEqual({ date: '2026-10-20', precision: 'day' });
    expect(parseShipmentDate('5.11.2026')).toEqual({ date: '2026-11-05', precision: 'day' });
    expect(parseShipmentDate('2026-11-05')).toEqual({ date: '2026-11-05', precision: 'day' });
    expect(parseShipmentDate('Sep-26')).toEqual({ date: '2026-09-01', precision: 'month' });
    expect(parseShipmentDate('September 2026')).toEqual({ date: '2026-09-01', precision: 'month' });
    expect(parseShipmentDate('09/2026')).toEqual({ date: '2026-09-01', precision: 'month' });
    expect(parseShipmentDate(null)).toEqual({ date: null, precision: null });
    expect(parseShipmentDate('   ')).toEqual({ date: null, precision: null });
    expect(parseShipmentDate('not a date')).toMatchObject({ date: null, precision: null, error: 'unparseable shipment date' });
  });

  it('parses integer cells', () => {
    expect(parseIntCell(2)).toBe(2);
    expect(parseIntCell('2')).toBe(2);
    expect(parseIntCell(' 3 ')).toBe(3);
    expect(parseIntCell(2.9)).toBe(2);
    expect(parseIntCell('2 x 20ft')).toBe(2);
    expect(parseIntCell(null)).toBeNull();
    expect(parseIntCell('')).toBeNull();
    expect(parseIntCell('n/a')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
// Fetching the file: what we refuse, and how we tell csv from xlsx from pdf.
// ---------------------------------------------------------------------------------------------------

describe('downloadImportFile', () => {
  afterEach(() => { delete process.env.IMPORT_ALLOWED_HOSTS; });

  it('downloads from the allow-listed host and names the file', async () => {
    const fetchImpl = stubFetch();
    const got = await downloadImportFile(`${HOST}/sol-pss.csv`);
    expect(got.file_name).toBe('sol-pss.csv');
    expect(got.format).toBe('csv');
    expect(got.buffer.toString('utf8')).toContain('Nestlé España');
    expect(String(fetchImpl.mock.calls[0][0])).toBe(`${HOST}/sol-pss.csv`);
  });

  it('refuses another host and plain http', async () => {
    stubFetch();
    await expect(downloadImportFile('https://evil.example/x.csv')).rejects.toMatchObject({ status: 400 });
    await expect(downloadImportFile('http://cdn.heylua.ai/uploads/sol-pss.csv')).rejects.toMatchObject({ status: 400 });
    await expect(downloadImportFile('not a url')).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a redirect that leaves the allow-list', async () => {
    const redirected = vi.fn(async () => {
      const res = new Response('Contract No,Buyer\nCT-1,X');
      Object.defineProperty(res, 'url', { value: 'https://evil.example/x.csv' });
      return res;
    });
    await expect(
      downloadImportFile(`${HOST}/sol-pss.csv`, { fetchImpl: redirected as unknown as typeof fetch }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('honours IMPORT_ALLOWED_HOSTS and an explicit allowedHosts list', async () => {
    const body = { body: 'Contract No,Buyer\nCT-1,X' };
    const fetchImpl = vi.fn(async () => new Response(body.body));
    await expect(
      downloadImportFile('https://files.sucafina.test/a.csv', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ status: 400 });
    process.env.IMPORT_ALLOWED_HOSTS = 'files.sucafina.test, other.test';
    const ok = await downloadImportFile('https://files.sucafina.test/a.csv', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(ok.format).toBe('csv');
    const explicit = await downloadImportFile('https://one.off.test/a.csv', {
      fetchImpl: fetchImpl as unknown as typeof fetch, allowedHosts: ['one.off.test'],
    });
    expect(explicit.file_name).toBe('a.csv');
  });

  it('rejects a PDF with the message that tells Harriet what to do instead', async () => {
    stubFetch();
    await expect(downloadImportFile(`${HOST}/sol.pdf`)).rejects.toMatchObject({
      status: 415,
      message: "PDF isn't supported yet — export the SOL report as Excel or CSV",
    });
  });

  it('caps the download at 10 MB, by header and by what actually arrived', async () => {
    stubFetch();
    await expect(downloadImportFile(`${HOST}/huge.csv`)).rejects.toMatchObject({ status: 413 });
    const big = Buffer.alloc(11 * 1024 * 1024, 0x61);
    const liar = vi.fn(async () => new Response(big, { headers: { 'content-length': '100' } }));
    await expect(
      downloadImportFile(`${HOST}/big.csv`, { fetchImpl: liar as unknown as typeof fetch }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('maps an upstream failure to 502 and a timeout to 504', async () => {
    stubFetch();
    await expect(downloadImportFile(`${HOST}/gone.csv`)).rejects.toMatchObject({ status: 502 });
    const abort = vi.fn(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); });
    await expect(
      downloadImportFile(`${HOST}/slow.csv`, { fetchImpl: abort as unknown as typeof fetch }),
    ).rejects.toMatchObject({ status: 504 });
  });

  it('reads the format from ?ext=, then the extension, then the magic bytes', async () => {
    const serve = (body: Buffer) => vi.fn(async () => new Response(body as unknown as BodyInit)) as unknown as typeof fetch;
    expect((await downloadImportFile(`${HOST}/report.bin?ext=xlsx`, { fetchImpl: serve(xlsxBytes) })).format).toBe('xlsx');
    expect((await downloadImportFile(`${HOST}/report.dat`, { fetchImpl: serve(xlsxBytes) })).format).toBe('xlsx');
    expect((await downloadImportFile(`${HOST}/report.dat`, { fetchImpl: serve(csvBytes) })).format).toBe('csv');
    await expect(
      downloadImportFile(`${HOST}/report.dat`, { fetchImpl: serve(Buffer.from('%PDF-1.7 x')) }),
    ).rejects.toMatchObject({ status: 415 });
  });

  it('reads a UTF-8 CSV as text and an xlsx as bytes', () => {
    const csv = readRows(csvBytes, 'csv');
    expect(csv.rows[5][1]).toBe('Nestlé España');
    const book = readRows(xlsxBytes, 'xlsx');
    expect(book.sheets).toEqual(['SOL']);
    expect(book.sheet).toBe('SOL');
    expect(book.rows[5][1]).toBe('Nestlé España');
    expect(book.rows[2]).toEqual(csv.rows[2]);
  });

  it('keeps CSV cells as the text that was typed — never a US-first date guess', () => {
    const rows = readRows(Buffer.from(DDMM_CSV, 'utf8'), 'csv').rows;
    expect(rows[1][4]).toBe('01/12/2026');
    expect(rows[2][4]).toBe('3/4/2027');
    expect(parseShipmentDate(rows[1][4])).toEqual({ date: '2026-12-01', precision: 'day' });
    expect(parseShipmentDate(rows[2][4])).toEqual({ date: '2027-04-03', precision: 'day' });
  });

  it('reads a real Excel date cell as that day', () => {
    const rows = readRows(DATE_CELL_XLSX, 'xlsx').rows;
    expect(parseShipmentDate(rows[1][4])).toEqual({ date: '2026-12-01', precision: 'day' });
  });
});

// ---------------------------------------------------------------------------------------------------
// The routes, against the real database.
// ---------------------------------------------------------------------------------------------------

describe('/imports/pss-schedule', () => {
  let pauligId = '';
  const previews: Row[] = [];

  beforeAll(async () => {
    const paulig = await auth(request(app).post('/clients')).send({ name: 'Paulig', country: 'Finland' });
    pauligId = paulig.body.id;
    await auth(request(app).post('/clients')).send({ name: 'Nestlé España', country: 'Spain' });
  });

  const preview = async (file: string, body: Record<string, unknown> = {}) => {
    stubFetch();
    return auth(request(app).post('/imports/pss-schedule')).send({ file_url: `${HOST}/${file}`, ...body });
  };
  const commit = (id: string, body: Record<string, unknown> = {}) =>
    auth(request(app).post(`/imports/pss-schedule/${id}/commit`)).send(body);
  const contractByNumber = async (n: string): Promise<Row> =>
    (await pool.query(`SELECT * FROM contracts WHERE contract_number = $1 AND deleted_at IS NULL`, [n])).rows[0];
  const today = async (): Promise<string> =>
    (await pool.query(`SELECT to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD') AS d`)).rows[0].d;

  it('1. previews the SOL sheet: four contract groups, one orphan row', async () => {
    const res = await preview('sol-pss.csv');
    expect(res.status).toBe(200);
    previews.push(res.body);
    expect(res.body.file_name).toBe('sol-pss.csv');
    expect(res.body.format).toBe('csv');
    expect(res.body.header_row).toBe(2);
    expect(res.body.detected_mapping).toEqual({
      contract_number: 'Contract No', client_name: 'Buyer', quality: 'Quality',
      destination: 'Destination', shipment_date: 'Shipment', containers: 'Ctrs', pss_expected: 'PSS',
    });
    expect(res.body.unmapped_headers).toEqual([]);
    expect(res.body.rows).toHaveLength(5);

    const [ct14, ct15, ct16, orphan, ct17] = res.body.rows as Row[];

    expect(ct14).toMatchObject({
      row_no: 4, contract_number: 'CT-2026-14', client_name: 'Paulig',
      client_match: { id: pauligId, name: 'Paulig', kind: 'exact' },
      quality: 'AB FAQ', destination: 'Finland',
      shipment_date: '2026-10-20', date_precision: 'day', shipment_month: 'October 2026',
      pss_due_date: '2026-09-05', containers: 2, pss_expected: 2, container_nos: [1, 2],
      existing_contract: null, action: 'create', problems: [], warnings: [],
    });

    expect(ct15).toMatchObject({
      row_no: 5, contract_number: 'CT-2026-15', client_name: 'Gustav Paulig Ltd (NEW) Jan 23',
      client_match: { id: pauligId, name: 'Paulig', kind: 'fuzzy' },
      shipment_date: '2026-09-01', date_precision: 'month', shipment_month: 'September 2026',
      containers: 1, pss_expected: 1, container_nos: [1], action: 'create', problems: [],
    });
    expect(ct15.warnings).toContain('shipment date given as a month — using the 1st');
    expect(ct15.warnings.some((w: string) => w.includes('Paulig'))).toBe(true);

    // Two rows for the same number are one contract of two containers.
    expect(ct16).toMatchObject({
      row_no: 6, contract_number: 'CT-2026-16', client_name: 'Nestlé España',
      shipment_date: '2026-11-05', date_precision: 'day', containers: 2, pss_expected: 2,
      container_nos: [1, 2], action: 'create', problems: [], warnings: [],
    });
    expect(ct16.client_match.kind).toBe('exact');

    expect(orphan).toMatchObject({
      row_no: 8, contract_number: null, client_name: 'Orphan row',
      action: 'skip', problems: ['missing contract number'],
    });

    expect(ct17).toMatchObject({
      row_no: 9, contract_number: 'CT-2026-17', client_name: 'Unknown Roasters',
      client_match: null, shipment_date: null, date_precision: null, action: 'create',
      problems: ['unparseable shipment date'],
      warnings: ['client not in the book — will be created on commit'],
    });

    expect(res.body.summary).toEqual({
      contracts: 4, create: 4, update: 0, skip: 1, pss_to_create: 5,
      problems: 2, warnings: 2, unmatched_clients: ['Unknown Roasters'],
    });
  });

  it('2. the xlsx of the same rows previews identically', async () => {
    const res = await preview('sol-pss.xlsx');
    expect(res.status).toBe(200);
    expect(res.body.format).toBe('xlsx');
    expect(res.body.sheet).toBe('SOL');
    expect(res.body.sheets).toEqual(['SOL']);
    expect(res.body.rows).toEqual(previews[0].rows);
    expect(res.body.summary).toEqual(previews[0].summary);
    expect(res.body.import_id).not.toBe(previews[0].import_id);
  });

  it('3. a disallowed host is 400, a PDF is 415, a headerless sheet is 422', async () => {
    stubFetch();
    const evil = await auth(request(app).post('/imports/pss-schedule')).send({ file_url: 'https://evil.example/x.csv' });
    expect(evil.status).toBe(400);
    const pdf = await preview('sol.pdf');
    expect(pdf.status).toBe(415);
    expect(pdf.body.error).toBe("PDF isn't supported yet — export the SOL report as Excel or CSV");
    const headerless = await preview('sol-noheader.csv');
    expect(headerless.status).toBe(422);
    expect(headerless.body.error).toBe('could not find a header row');
    // Nothing was stored for the refusals.
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pss_imports`);
    expect(rows[0].n).toBe(2);
  });

  it('4. GET returns the stored preview and its status', async () => {
    const res = await auth(request(app).get(`/imports/pss-schedule/${previews[0].import_id}`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      import_id: previews[0].import_id, file_name: 'sol-pss.csv', format: 'csv',
      header_row: 2, status: 'preview',
    });
    expect(res.body.rows).toEqual(previews[0].rows);
    expect(res.body.summary).toEqual(previews[0].summary);
    expect(res.body.detected_mapping).toEqual(previews[0].detected_mapping);
    expect((await auth(request(app).get(`/imports/pss-schedule/${pauligId}`))).status).toBe(404);
  });

  it('5. commit creates three contracts and one PSS per container, and pings QC once', async () => {
    const res = await commit(previews[0].import_id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ contracts_created: 3, contracts_updated: 0, pss_created: 5, skipped: 2 });
    expect(res.body.contract_ids).toHaveLength(3);

    const ct14 = await contractByNumber('CT-2026-14');
    expect(ct14).toMatchObject({
      client_id: pauligId, client_name: 'Paulig', quality: 'AB FAQ', destination: 'Finland',
      shipment_month: 'October 2026', containers: 2, pss_expected: 2,
      status: 'pss_pending', source: 'sol_import', import_id: previews[0].import_id,
    });
    expect(ct14.shipment_date).toBe('2026-10-20');
    expect(ct14.pss_due_date).toBe('2026-09-05');
    // The fuzzy match is applied: the contract carries the client from the book, not the sheet's spelling.
    expect((await contractByNumber('CT-2026-15')).client_id).toBe(pauligId);
    expect(await contractByNumber('CT-2026-17')).toBeUndefined();

    const { rows: pss } = await pool.query(
      `SELECT b.*, c.contract_number FROM bulk_samples b JOIN contracts c ON c.id = b.contract_id
        WHERE b.deleted_at IS NULL ORDER BY c.contract_number, b.container_no`);
    expect(pss).toHaveLength(5);
    expect(pss.map((r) => r.sample_ref)).toEqual(['SSKE-108000', 'SSKE-108001', 'SSKE-108002', 'SSKE-108003', 'SSKE-108004']);
    expect(pss.map((r) => `${r.contract_number}/${r.container_no}`)).toEqual([
      'CT-2026-14/1', 'CT-2026-14/2', 'CT-2026-15/1', 'CT-2026-16/1', 'CT-2026-16/2',
    ]);
    const stamp = await today();
    for (const r of pss) {
      expect(r.sample_type_norm).toBe('pss');
      expect(r.status).toBe('requested');
      expect(r.comments).toBe(`PSS scheduled from SOL import ${stamp}`);
      expect(r.requested_by).toBe('Ivo');
      expect(r.logged_by).toBe('Ivo');
    }

    // ONE grouped alert for the whole import, and not a single per-sample 'created' ping.
    const { rows: outbox } = await pool.query(`SELECT * FROM notifications_outbox ORDER BY created_at`);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      tab: 'import', sample_id: previews[0].import_id, event: 'pss_schedule_imported', recipient: 'qc', actor: 'dashboard:Ivo',
    });
    expect(outbox[0].payload).toEqual({
      file_name: 'sol-pss.csv', contracts_created: 3, contracts_updated: 0, pss_created: 5,
      first_due: '2026-07-18', actor: 'Ivo',
    });

    const { rows: events } = await pool.query(
      `SELECT * FROM events WHERE entity_type = 'import' AND entity_id = $1`, [previews[0].import_id]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'created', note: 'committed: 5 PSS across 3 contracts', actor: 'dashboard:Ivo' });

    const stored = await auth(request(app).get(`/imports/pss-schedule/${previews[0].import_id}`));
    expect(stored.body.status).toBe('committed');
    expect(stored.body.summary).toMatchObject({ contracts_created: 3, pss_created: 5 });
  });

  it('6. the import alert reaches outbox-pending and can be marked sent', async () => {
    const pending = await auth(request(app).get('/notifications/outbox-pending'));
    const item = pending.body.items.find((i: Row) => i.tab === 'import');
    expect(item).toMatchObject({ event: 'pss_schedule_imported', ref: 'sol-pss.csv', recipients: [] });
    const mark = await auth(request(app).post('/notifications/outbox-mark')).send({ id: item.outbox_id, via: 'teams', detail: 'QC desk' });
    expect(mark.status).toBe(200);
    const { rows } = await pool.query(`SELECT sent_at FROM notifications_outbox WHERE id = $1`, [item.outbox_id]);
    expect(rows[0].sent_at).not.toBeNull();
    const { rows: notes } = await pool.query(
      `SELECT * FROM events WHERE entity_type = 'import' ORDER BY created_at`);
    expect(notes.map((e) => e.type)).toEqual(['created', 'notified']);
    expect(notes[1].note).toBe('Quality team notified: PSS schedule imported — QC desk');
  });

  it('7. committing the same import twice is a 409', async () => {
    const again = await commit(previews[0].import_id);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already committed/);
  });

  it('8. re-uploading the same schedule wants nothing: all updates, zero PSS', async () => {
    const res = await preview('sol-pss.csv');
    expect(res.status).toBe(200);
    const rows = res.body.rows as Row[];
    expect(rows.filter((r) => r.action === 'update')).toHaveLength(3);
    expect(rows.find((r) => r.contract_number === 'CT-2026-14')!.existing_contract).toMatchObject({ status: 'pss_pending', pss_expected: 2 });
    expect(res.body.summary).toMatchObject({ contracts: 4, create: 1, update: 3, skip: 1, pss_to_create: 0 });

    const done = await commit(res.body.import_id);
    expect(done.body).toMatchObject({ contracts_created: 0, contracts_updated: 3, pss_created: 0, skipped: 2 });
    const { rows: pss } = await pool.query(`SELECT count(*)::int AS n FROM bulk_samples WHERE deleted_at IS NULL`);
    expect(pss[0].n).toBe(5);
    const { rows: alerts } = await pool.query(`SELECT count(*)::int AS n FROM notifications_outbox WHERE tab = 'import'`);
    expect(alerts[0].n).toBe(2);
  });

  it('9. an override skips a row, and never lowers what a contract already expects', async () => {
    const res = await preview('sol-pss.csv');
    const ct14 = (res.body.rows as Row[]).find((r) => r.contract_number === 'CT-2026-14')!;
    const before = await contractByNumber('CT-2026-14');
    const done = await commit(res.body.import_id, { overrides: [{ row_no: ct14.row_no, skip: true }] });
    expect(done.body).toMatchObject({ contracts_created: 0, contracts_updated: 2, pss_created: 0, skipped: 3 });
    expect(done.body.contract_ids).not.toContain(before.id);
    const after = await contractByNumber('CT-2026-14');
    expect(after.updated_at).toEqual(before.updated_at);
    expect(after.pss_expected).toBe(2);
  });

  it('10. an unmatched client is created on commit; an override picks an existing one instead', async () => {
    const res = await preview('sol-extra.csv');
    expect(res.body.header_row).toBe(0);
    expect(res.body.summary).toMatchObject({ contracts: 2, create: 2, pss_to_create: 2, unmatched_clients: ['Bean There Trading', 'Kaldi Coffee Roasters'] });
    const bean = (res.body.rows as Row[]).find((r) => r.client_name === 'Bean There Trading')!;
    const done = await commit(res.body.import_id, { overrides: [{ row_no: bean.row_no, client_id: pauligId }] });
    expect(done.body).toMatchObject({ contracts_created: 2, pss_created: 2, skipped: 0 });

    const { rows: shells } = await pool.query(`SELECT * FROM clients WHERE name IN ('Kaldi Coffee Roasters', 'Bean There Trading')`);
    expect(shells).toHaveLength(1);
    expect(shells[0]).toMatchObject({ name: 'Kaldi Coffee Roasters', country: 'Kenya' });
    expect((await contractByNumber('CT-2026-20')).client_id).toBe(shells[0].id);
    expect((await contractByNumber('CT-2026-21')).client_id).toBe(pauligId);
    const { rows: made } = await pool.query(
      `SELECT * FROM events WHERE entity_type = 'client' AND entity_id = $1`, [shells[0].id]);
    expect(made.map((e) => e.type)).toEqual(['created']);
  });

  it('11. a preview whose every row has a problem cannot be committed', async () => {
    const res = await preview('sol-bad.csv');
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ contracts: 0, skip: 1, problems: 1, pss_to_create: 0 });
    const done = await commit(res.body.import_id);
    expect(done.status).toBe(422);
    expect((await pool.query(`SELECT status FROM pss_imports WHERE id = $1`, [res.body.import_id])).rows[0].status).toBe('preview');
  });

  it('12. a caller mapping and an explicit header row override the detection', async () => {
    const res = await preview('sol-pss.csv', { header_row: 2, mapping: { notes: 'Quality' } });
    expect(res.status).toBe(200);
    expect(res.body.detected_mapping.notes).toBe('Quality');
    expect(res.body.detected_mapping.quality).toBeUndefined();
    expect((res.body.rows as Row[])[0]).toMatchObject({ notes: 'AB FAQ', quality: null });
    const bad = await preview('sol-pss.csv', { mapping: { nonsense: 'Quality' } });
    expect(bad.status).toBe(400);
  });

  it('14. an ambiguous dd/mm date in a CSV previews day-first (01/12/2026 → 2026-12-01), and an Excel date cell too', async () => {
    const csv = await preview('sol-ddmm.csv');
    expect(csv.status).toBe(200);
    expect(csv.body.rows.map((r: Row) => [r.contract_number, r.shipment_date, r.pss_due_date])).toEqual([
      ['CT-2026-40', '2026-12-01', '2026-10-17'],
      ['CT-2026-41', '2027-04-03', '2027-02-17'],
    ]);
    const xlsx = await preview('sol-datecell.xlsx');
    expect(xlsx.status).toBe(200);
    expect(xlsx.body.rows[0]).toMatchObject({ contract_number: 'CT-2026-42', shipment_date: '2026-12-01', date_precision: 'day' });
  });

  it('13. a zero in the count columns reads as "not given", never as a contract of no containers', async () => {
    const res = await preview('sol-zeroes.csv');
    expect(res.status).toBe(200);
    expect((res.body.rows as Row[])[0]).toMatchObject({ containers: 1, pss_expected: 1, container_nos: [1] });
  });
});
