import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import pg from 'pg';
import {
  parseQtyGrams, normalizeCourier, classifySampleType, parseSheetDate, normalizeName, parseResult, parseNumeric,
} from './parsers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const XLSX_PATH = path.resolve(__dirname, '../../docs/Sample Chaser2025-2026 - Sample Chaser.xlsx');
const DB_URL = process.env.DATABASE_URL ?? 'postgres://sucafina:sucafina@localhost:5433/sucafina';

type Row = unknown[];
const warnings: { sheet: string; row: number; reason: string }[] = [];
const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const fmtDate = (v: unknown): string | null => {
  const d = parseSheetDate(v);
  return d ? d.toISOString().slice(0, 10) : str(v);
};
let specialtyLoaded = 0, bulkLoaded = 0, forwardingLoaded = 0;

const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
const rowsOf = (name: string): Row[] =>
  XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], { header: 1, defval: null });

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();

// wipe previously seeded data (idempotent reruns) but keep agent-created rows intact on --keep
if (!process.argv.includes('--keep')) {
  await client.query(`TRUNCATE events, forwarding_samples, bulk_samples, specialty_samples,
    sample_events, samples, client_contacts, clients, traders RESTART IDENTITY CASCADE`);
}

// ---- 1. clients -------------------------------------------------------
const clientRows = rowsOf('Client Details').slice(1).filter((r) => str(r[0]));
const clientIdByKey = new Map<string, string>();
let contactCount = 0;
for (const r of clientRows) {
  const name = String(str(r[0]));
  const key = normalizeName(name);
  let id = clientIdByKey.get(key);
  if (!id) {
    const ins = await client.query(
      `INSERT INTO clients (name) VALUES ($1) RETURNING id`, [name.trim().replace(/\s+/g, ' ')]);
    id = ins.rows[0].id as string;
    clientIdByKey.set(key, id);
  }
  if (str(r[1]) || str(r[2]) || str(r[3]) || str(r[4])) {
    await client.query(
      `INSERT INTO client_contacts (client_id, attention_to, full_address, phone, email) VALUES ($1,$2,$3,$4,$5)`,
      [id, str(r[1]), str(r[2]), str(r[3]), str(r[4])]);
    contactCount++;
  }
}

// ---- 1b. traders (from the persona's known team; clients left unassigned) --
const TRADERS: ReadonlyArray<readonly [string, 'trader' | 'qc']> = [
  ['Ivo', 'trader'], ['Omar', 'trader'], ['Muki', 'trader'], ['Brian', 'trader'], ['Gloria', 'trader'],
  ['Bernard', 'qc'], ['Brillian', 'qc'], ['Harriet', 'qc'], ['Anička', 'qc'],
];
for (const [name, role] of TRADERS) {
  await client.query(
    `INSERT INTO traders (name, role) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
    [name, role]);
}

function resolveClient(receiver: string | null): string | null {
  if (!receiver) return null;
  const key = normalizeName(receiver);
  if (clientIdByKey.has(key)) return clientIdByKey.get(key)!;
  if (key.length < 4) return null;
  for (const [k, id] of clientIdByKey) {
    if (k.includes(key) || key.includes(k)) return id;
  }
  return null;
}

// ---- 2. samples -------------------------------------------------------
type Prepared = Record<string, unknown>;
let loaded = 0;

async function insertSample(p: Prepared, sheet: string, rowNum: number) {
  try {
    const ins = await client.query(
      `INSERT INTO samples (ref, ref_raw, source_sheet, sample_type, shipment_month, quality, grade,
         outturn, mark_name, ico_mark, client_ref, bags, qty_grams, qty_raw, moisture, water_activity,
         client_id, receiver, status, courier, courier_raw, awb,
         requested_at, dispatched_at, delivered_at, result, comments, crop_year)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       RETURNING id`,
      [p.ref, p.ref_raw, sheet, p.sample_type, p.shipment_month, p.quality, p.grade,
       p.outturn, p.mark_name, p.ico_mark, p.client_ref, p.bags, p.qty_grams, p.qty_raw, p.moisture, p.water_activity,
       p.client_id, p.receiver, p.status, p.courier, p.courier_raw, p.awb,
       p.requested_at, p.dispatched_at, p.delivered_at, p.result, p.comments, p.crop_year]);
    const id = ins.rows[0].id;
    await client.query(
      `INSERT INTO sample_events (sample_id, type, note, actor, created_at) VALUES ($1,'requested','imported from Sample Chaser','seed', $2)`,
      [id, p.requested_at ?? new Date()]);
    if (p.status !== 'requested') {
      await client.query(
        `INSERT INTO sample_events (sample_id, type, note, actor, created_at) VALUES ($1,'dispatched',$2,'seed',$3)`,
        [id, `via ${p.courier_raw ?? '?'} AWB ${p.awb ?? '—'}`, p.dispatched_at ?? p.requested_at ?? new Date()]);
    }
    loaded++;
  } catch (e) {
    warnings.push({ sheet, row: rowNum, reason: (e as Error).message.slice(0, 200) });
  }
}

function inferStatus(result: string | null, deliveredAt: Date | null, awb: string | null, courier: string | null) {
  if (result) return 'results_in';
  if (deliveredAt) return 'delivered';
  if (awb || courier) return 'dispatched';
  return 'requested';
}

async function insertSpecialtySample(r: Row) {
  const d0 = parseSheetDate(r[0]); const dd = parseSheetDate(r[11]);
  const result = parseResult(r[12]); const awb = str(r[8]);
  const courierNorm = normalizeCourier(r[9]);
  const st = classifySampleType(r[6]);
  const status = inferStatus(result, dd, awb, courierNorm);
  const { rows } = await client.query(
    `INSERT INTO specialty_samples
       (date, ref, outturn, name, grade, bags, description, receiver_company, awb, courier, qty,
        delivery_date, result, comments, crop_year, crop_area_details,
        date_on, delivery_on, qty_grams, courier_norm, result_norm, sample_type_norm, client_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING id`,
    [fmtDate(r[0]), str(r[1]), str(r[2]), str(r[3]), str(r[4]),
     typeof r[5] === 'number' ? Math.round(r[5]) : null, str(r[6]), str(r[7]), awb, str(r[9]), str(r[10]),
     fmtDate(r[11]), str(r[12]), str(r[13]), str(r[14]), str(r[15]),
     d0, dd, parseQtyGrams(r[10]), courierNorm, result, st.type, resolveClient(str(r[7])), status]);
  await client.query(
    `INSERT INTO events (entity_type, entity_id, type, note, actor, created_at)
     VALUES ('specialty',$1,'created','imported from Sample Chaser','seed',$2)`,
    [rows[0].id, d0 ?? new Date()]);
  specialtyLoaded++;
}

async function insertBulkSample(r: Row) {
  const d0 = parseSheetDate(r[0]); const dd = parseSheetDate(r[14]);
  const result = parseResult(r[15]); const awb = str(r[9]);
  const courierNorm = normalizeCourier(r[10]);
  const st = classifySampleType(r[6]);
  const status = inferStatus(result, dd, awb, courierNorm);
  const { rows } = await client.query(
    `INSERT INTO bulk_samples
       (date, sample_ref, bags, quality, client_ref, ico_mark, sample_type, client, country, awb,
        courier, qty, moisture, water_activity, delivery_date, result, comments, crop_year, crop_area_details,
        date_on, delivery_on, qty_grams, courier_norm, result_norm, sample_type_norm,
        moisture_pct, water_activity_num, client_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
     RETURNING id`,
    [fmtDate(r[0]), str(r[1]), typeof r[2] === 'number' ? Math.round(r[2]) : null, str(r[3]), str(r[4]),
     str(r[5]), str(r[6]), str(r[7]), str(r[8]), awb, str(r[10]), str(r[11]),
     str(r[12]), str(r[13]), fmtDate(r[14]), str(r[15]), str(r[16]), str(r[17]), str(r[18]),
     d0, dd, parseQtyGrams(r[11]), courierNorm, result, st.type,
     parseNumeric(r[12]), parseNumeric(r[13]), resolveClient(str(r[7])), status]);
  await client.query(
    `INSERT INTO events (entity_type, entity_id, type, note, actor, created_at)
     VALUES ('bulk',$1,'created','imported from Sample Chaser','seed',$2)`,
    [rows[0].id, d0 ?? new Date()]);
  bulkLoaded++;
}

async function insertForwardingSample(r: Row) {
  const d0 = parseSheetDate(r[0]); const awb = str(r[7]);
  const courierNorm = normalizeCourier(r[8]);
  const status = awb || courierNorm ? 'dispatched' : 'requested';
  const { rows } = await client.query(
    `INSERT INTO forwarding_samples
       (date, sender, origin, sample_ref, coffee_quality, receiver_company, id_number, awb, courier, qty,
        date_on, qty_grams, courier_norm, client_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id`,
    [fmtDate(r[0]), str(r[1]), str(r[2]), str(r[3]), str(r[4]), str(r[5]), str(r[6]), awb, str(r[8]), str(r[9]),
     d0, parseQtyGrams(r[9]), courierNorm, resolveClient(str(r[5])), status]);
  await client.query(
    `INSERT INTO events (entity_type, entity_id, type, note, actor, created_at)
     VALUES ('forwarding',$1,'created','imported from E A Forwarding','seed',$2)`,
    [rows[0].id, d0 ?? new Date()]);
  forwardingLoaded++;
}

// Specialty sheet
const spec = rowsOf('Specialty Samples 2024-2025');
for (let i = 1; i < spec.length; i++) {
  const r = spec[i];
  if (!r || !r.some((v) => str(v))) continue;
  const requestedAt = parseSheetDate(r[0]);
  const deliveredAt = parseSheetDate(r[11]);
  const result = parseResult(r[12]);
  const awb = str(r[8]);
  const courier = normalizeCourier(r[9]);
  const st = classifySampleType(r[6]);
  await insertSample({
    ref: null, ref_raw: str(r[1]), sample_type: st.type, shipment_month: st.shipmentMonth,
    quality: str(r[4]) && str(r[3]) ? `${str(r[4])} ${str(r[3])}` : str(r[4]) ?? str(r[3]),
    grade: str(r[4]), outturn: str(r[2]), mark_name: str(r[3]), ico_mark: null, client_ref: null,
    bags: typeof r[5] === 'number' ? Math.round(r[5]) : null,
    qty_grams: parseQtyGrams(r[10]), qty_raw: str(r[10]), moisture: null, water_activity: null,
    client_id: resolveClient(str(r[7])), receiver: str(r[7]),
    status: inferStatus(result, deliveredAt, awb, courier),
    courier, courier_raw: str(r[9]), awb,
    requested_at: requestedAt, dispatched_at: awb || courier ? requestedAt : null, delivered_at: deliveredAt,
    result, comments: str(r[13]), crop_year: str(r[14]),
  }, 'specialty', i + 1);
}

// Bulk sheet
const bulk = rowsOf('BulkSamples 2024-2025');
for (let i = 1; i < bulk.length; i++) {
  const r = bulk[i];
  if (!r || !r.some((v) => str(v))) continue;
  const requestedAt = parseSheetDate(r[0]);
  const deliveredAt = parseSheetDate(r[14]);
  const result = parseResult(r[15]);
  const awb = str(r[9]);
  const courier = normalizeCourier(r[10]);
  const st = classifySampleType(r[6]);
  await insertSample({
    ref: null, ref_raw: str(r[1]), sample_type: st.type, shipment_month: st.shipmentMonth,
    quality: str(r[3]), grade: null, outturn: null, mark_name: null,
    ico_mark: str(r[5]), client_ref: str(r[4]),
    bags: typeof r[2] === 'number' ? Math.round(r[2]) : null,
    qty_grams: parseQtyGrams(r[11]), qty_raw: str(r[11]),
    moisture: str(r[12]), water_activity: str(r[13]),
    client_id: resolveClient(str(r[7])), receiver: str(r[7]),
    status: inferStatus(result, deliveredAt, awb, courier),
    courier, courier_raw: str(r[10]), awb,
    requested_at: requestedAt, dispatched_at: awb || courier ? requestedAt : null, delivered_at: deliveredAt,
    result, comments: str(r[16]), crop_year: str(r[17]),
  }, 'bulk', i + 1);
}

// ---- 2b. new dedicated tables (legacy `samples` load above is unchanged) ----
for (let i = 1; i < spec.length; i++) {
  const r = spec[i];
  if (!r || !r.some((v) => str(v))) continue;
  await insertSpecialtySample(r);
}
for (let i = 1; i < bulk.length; i++) {
  const r = bulk[i];
  if (!r || !r.some((v) => str(v))) continue;
  await insertBulkSample(r);
}
const fwd = rowsOf('E A Forwarding 2024-2025');
for (let i = 1; i < fwd.length; i++) {
  const r = fwd[i];
  if (!r || !r.some((v) => str(v))) continue;
  await insertForwardingSample(r);
}

// ---- 3. ref counters above any seeded numeric refs --------------------
for (const [prefix, floor] of [['SL', 8000], ['TYPE', 1000], ['SSKE', 108000]] as const) {
  const { rows } = await client.query(
    `SELECT max((regexp_match(ref_raw, '^${prefix}[\\s-]*([0-9]+)', 'i'))[1]::int) AS m FROM samples WHERE ref_raw ~* '^${prefix}'`);
  const next = Math.max(floor, (rows[0].m ?? 0) + 1);
  await client.query(`UPDATE ref_counters SET next_val = $2 WHERE prefix = $1`, [prefix, next]);
}

// ---- 4. report --------------------------------------------------------
const nonEmpty = (name: string): number =>
  rowsOf(name).slice(1).filter((r) => r && r.some((v) => str(v))).length;
const counts = await client.query(`
  SELECT (SELECT count(*)::int FROM clients) AS clients,
         (SELECT count(*)::int FROM client_contacts) AS contacts,
         (SELECT count(*)::int FROM traders) AS traders,
         (SELECT count(*)::int FROM samples) AS legacy_samples,
         (SELECT count(*)::int FROM specialty_samples) AS specialty_samples,
         (SELECT count(*)::int FROM bulk_samples) AS bulk_samples,
         (SELECT count(*)::int FROM forwarding_samples) AS forwarding_samples,
         (SELECT count(*)::int FROM events) AS events`);
const c = counts.rows[0];
const expected = {
  specialty_samples: nonEmpty('Specialty Samples 2024-2025'),
  bulk_samples: nonEmpty('BulkSamples 2024-2025'),
  forwarding_samples: nonEmpty('E A Forwarding 2024-2025'),
};
const dropped = {
  specialty_samples: expected.specialty_samples - c.specialty_samples,
  bulk_samples: expected.bulk_samples - c.bulk_samples,
  forwarding_samples: expected.forwarding_samples - c.forwarding_samples,
};
const report = { ...c, expected, dropped, warnings: warnings.length, details: warnings };
writeFileSync(path.resolve(__dirname, '../seed-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, details: undefined }, null, 2));
await client.end();
