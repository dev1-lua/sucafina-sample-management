// Feedback ⑫ (Bernard): printable physical labels for sample bags and consignment boxes.
// Gloria's sample slips (2026-09-11) set the look: the round Kenyacof mark on top, then one bold
// "Label: value" per line — Stocklot · Outturn · Grower · Screen · Crop for a specialty lot. Under the
// slip a small Code 39 strip carries the ref, so QC can still scan a bag back to its row. Everything here
// is self-contained (inline SVG, no CDN), so it works offline and inside the print window's own document.
// Code 39 because refs/CN numbers are plain uppercase alphanumerics + dashes, and any warehouse scanner
// reads it without a checksum.

import { formatLocation } from '@/lib/format';
// The mark, traced from the slip Gloria sent (Vite `?raw` → the SVG source as a string).
import markSvg from '@/assets/kenyacof-mark.svg?raw';

export type LabelLine = { label: string; value: string };
export type LabelData = {
  code: string; // barcode value, printed small under it (sample ref or consignment number)
  kind: string; // what it is, next to the ref: "Specialty sample", "Commercial sample · PSS", "Consignment"
  lines: LabelLine[]; // the slip body, in print order
  footer?: string; // a consignment's member refs
};

// --- Code 39 ---------------------------------------------------------------
// Each character is 9 elements (5 bars / 4 spaces, alternating, bar first); exactly
// 3 are wide. The assignment is systematic: characters in value order are grouped in
// tens; each group fixes which SPACE is wide, and the two wide BARS cycle through the
// same 10 (position, position) pairs in every group. Generating the table from that
// rule (instead of hand-typing 40 nine-char strings) leaves no room for typos.
const CODE39_ORDER = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ-. *';
const WIDE_SPACE_BY_GROUP = [4, 6, 8, 2]; // element position (1-indexed) per group of 10
const WIDE_BAR_CYCLE: Array<[number, number]> = [
  [1, 9], [3, 9], [1, 3], [5, 9], [1, 5], [3, 5], [7, 9], [1, 7], [3, 7], [5, 7],
];

function code39Pattern(ch: string): number[] {
  const idx = CODE39_ORDER.indexOf(ch);
  if (idx === -1) throw new Error(`not a Code 39 character: ${ch}`);
  const wide = new Set<number>([WIDE_SPACE_BY_GROUP[Math.floor(idx / 10)], ...WIDE_BAR_CYCLE[idx % 10]]);
  // Element widths in narrow units (wide = 3× narrow, per the spec's preferred ratio).
  return Array.from({ length: 9 }, (_, i) => (wide.has(i + 1) ? 3 : 1));
}

/** Strip anything a Code 39 symbol can't carry (keeps 0-9 A-Z dash dot space). */
export function code39Sanitize(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z\-. ]/g, '');
}

/** Render `value` as a Code 39 barcode SVG string (start/stop `*` added here). */
export function code39Svg(value: string, height = 44): string {
  const text = `*${code39Sanitize(value)}*`;
  const rects: string[] = [];
  let x = 0;
  for (const ch of text) {
    code39Pattern(ch).forEach((w, i) => {
      if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
      x += w;
    });
    x += 1; // inter-character gap (one narrow space)
  }
  const width = x - 1; // no gap after the stop character
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="100%" height="${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(value)}">` +
    `<g fill="#000">${rects.join('')}</g></svg>`
  );
}

// --- Label data builders -----------------------------------------------------
function str(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** Keep the lines that have something to print. */
function present(lines: Array<{ label: string; value: string | null }>): LabelLine[] {
  return lines.filter((l): l is LabelLine => l.value != null);
}

type Book = 'specialty' | 'bulk' | 'forwarding';

/** Which book a row belongs to: `tab` when the row carries one (search hits, digest,
 * client orders), else the columns only that book has (see the three API routers). */
function bookOf(row: Record<string, unknown>): Book {
  const tab = row.tab;
  if (tab === 'specialty' || tab === 'bulk' || tab === 'forwarding') return tab;
  if ('coffee_quality' in row || 'id_number' in row || 'sender' in row || 'origin' in row) return 'forwarding';
  if ('quality' in row || 'ico_mark' in row || 'client_ref' in row) return 'bulk';
  return 'specialty';
}

/** The slip's grower: the wet mill before the "/" of the book's name ("KII/KIRINYAGA" → "KII"), without
 * a leading grade the desk sometimes types into the name ("AA SANGALAI" on an AA lot → "SANGALAI"). */
function growerOf(name: string | null, grade: string | null): string | null {
  if (!name) return null;
  let grower = name.split('/')[0].trim();
  if (grade && grower.toUpperCase().startsWith(`${grade.toUpperCase()} `)) grower = grower.slice(grade.length).trim();
  return grower || null;
}

/** Kenya's coffee season runs October → September: 11 Sep 2026 is in 2025/2026, 1 Oct 2026 opens 2026/2027. */
function coffeeSeason(year: number, month: number): string {
  return month >= 10 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

/** The crop to print: the one on file, else (decision 2026-09-11) the season the sample was logged in —
 * or, for a row with no readable date, the season of the day it is printed. */
function cropOf(row: Record<string, unknown>, now: Date): string {
  const saved = str(row, 'crop_year');
  if (saved) return saved;
  const logged = /^(\d{4})-(\d{2})/.exec(str(row, 'date_on') ?? str(row, 'date') ?? '');
  return logged ? coffeeSeason(Number(logged[1]), Number(logged[2])) : coffeeSeason(now.getFullYear(), now.getMonth() + 1);
}

/** Build label data from any of the three books' detail rows. A specialty lot prints Gloria's slip;
 * a commercial sample or forwarding parcel prints the same way, led by its ref (the name it goes by). */
export function sampleLabelData(row: Record<string, unknown>, now: Date = new Date()): LabelData {
  const code = str(row, 'ref') ?? str(row, 'sample_ref') ?? String(row.id ?? '');
  const book = bookOf(row);
  const isPss = (str(row, 'sample_type_norm') ?? str(row, 'sample_type'))?.toLowerCase() === 'pss';
  const pss = isPss ? ' · PSS' : '';
  // A PSS names its contract and option letter (a row from before the letters shows its slot number).
  const contract = [
    { label: 'Contract', value: str(row, 'contract_number') },
    { label: 'Option', value: isPss ? str(row, 'option_letter') ?? str(row, 'container_no') : null },
  ];
  const client = str(row, 'client') ?? str(row, 'receiver_company') ?? str(row, 'receiver');

  if (book === 'specialty') {
    const grade = str(row, 'grade');
    const lot = present([
      { label: 'Stocklot', value: str(row, 'stocklot') },
      { label: 'Outturn', value: str(row, 'outturn') },
      { label: 'Grower', value: growerOf(str(row, 'name'), grade) },
    ]);
    // A row with nothing that names the lot (a walk-in, a blend) at least says what it is.
    const what = lot.length > 0 ? lot : present([{ label: 'Description', value: str(row, 'description') }]);
    return {
      code,
      kind: `Specialty sample${pss}`,
      lines: [...what, ...present([{ label: 'Screen', value: grade }, { label: 'Crop', value: cropOf(row, now) }, ...contract])],
    };
  }
  if (book === 'forwarding') {
    return {
      code,
      kind: 'Forwarding parcel',
      lines: present([{ label: 'Ref', value: code }, { label: 'Quality', value: str(row, 'coffee_quality') }, { label: 'Client', value: client }]),
    };
  }
  return {
    code,
    kind: `Commercial sample${pss}`,
    lines: present([
      { label: 'Ref', value: code },
      ...contract,
      { label: 'Quality', value: str(row, 'quality') },
      { label: 'Shipment', value: str(row, 'shipment_month') },
      { label: 'Client', value: client },
      { label: 'Crop', value: cropOf(row, now) },
    ]),
  };
}

export type ConsignmentLabelMember = {
  ref: string | null;
  outturn?: string | null;
  contract_number?: string | null;
  sample_type_norm?: string | null;
};

/** One footer entry per member: `ref · outturn`, `ref · contract` for a PSS, or just the ref. */
function memberLine(m: ConsignmentLabelMember): string | null {
  if (!m.ref) return null;
  const second = m.outturn || (m.sample_type_norm?.toLowerCase() === 'pss' ? m.contract_number : null);
  return second ? `${m.ref} · ${second}` : m.ref;
}

export function consignmentLabelData(c: {
  number: string;
  location: string | null;
  member_count: number;
  members: ConsignmentLabelMember[];
}): LabelData {
  const refs = c.members.map(memberLine).filter((line): line is string => line != null).join(' | ');
  return {
    code: c.number,
    kind: 'Consignment',
    lines: present([
      { label: 'Consignment', value: c.number },
      { label: 'Location', value: formatLocation(c.location) },
      { label: 'Samples', value: String(c.member_count) },
    ]),
    footer: refs || undefined,
  };
}

// --- Print window --------------------------------------------------------------
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The print window's full document. Exported for tests; openPrintLabel writes it. */
export function labelHtml(label: LabelData): string {
  const lines = label.lines
    .map((l) => `<div class="line"><span class="k">${escapeHtml(l.label)}:</span> <span class="v">${escapeHtml(l.value)}</span></div>`)
    .join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Label ${escapeHtml(label.code)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #000; background: #f4f4f4;
         display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 16px; }
  .toolbar button { font: inherit; padding: 6px 16px; cursor: pointer; }
  .label { width: 62mm; background: #fff; border: 1px dashed #999; padding: 4mm 5mm 3mm; }
  .mark { display: flex; justify-content: center; line-height: 0; margin-bottom: 4mm; }
  .mark svg { width: 15mm; height: 15mm; }
  /* The slip's text block: left-aligned lines, the block itself centred under the mark. */
  .lines { width: fit-content; max-width: 100%; margin: 0 auto; }
  .line { font-size: 13pt; font-weight: 700; line-height: 1.2; overflow-wrap: anywhere; }
  .barcode { margin-top: 4mm; line-height: 0; }
  .ref { font-size: 7pt; letter-spacing: 0.04em; text-align: center; margin-top: 1mm; }
  .members { font-size: 7pt; margin-top: 1.5mm; overflow-wrap: anywhere; }
  @media print {
    @page { margin: 5mm; }
    body { background: #fff; padding: 0; display: block; }
    .toolbar { display: none; }
    .label { border: none; }
  }
</style>
</head>
<body>
<div class="toolbar"><button onclick="window.print()">Print</button></div>
<div class="label">
  <div class="mark">${markSvg}</div>
  <div class="lines">${lines}</div>
  <div class="barcode">${code39Svg(label.code, 28)}</div>
  <div class="ref">${escapeHtml(label.code)} · ${escapeHtml(label.kind)}</div>
  ${label.footer ? `<div class="members">${escapeHtml(label.footer)}</div>` : ''}
</div>
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 150); });</script>
</body>
</html>`;
}

/** Open the label in its own small window and trigger the browser print dialog.
 * Called from a click handler, so popup blockers let it through. */
export function openPrintLabel(label: LabelData): void {
  const w = window.open('', '_blank', 'width=420,height=560');
  if (!w) return; // popup blocked — nothing sensible to do
  w.document.open();
  w.document.write(labelHtml(label));
  w.document.close();
}
