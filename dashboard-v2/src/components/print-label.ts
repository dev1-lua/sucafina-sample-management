// Feedback ⑫ (Bernard): printable physical labels for sample bags and consignment boxes.
// Everything here is self-contained — the barcode is Code 39 rendered as inline SVG (no
// CDN, works offline and inside the print window's isolated document). Code 39 because
// refs/CN numbers are plain uppercase alphanumerics + dashes, and any warehouse scanner
// reads it without a checksum.

import { formatLocation } from '@/lib/format';

export type LabelField = { label: string; value: string };
export type LabelData = {
  code: string; // headline + barcode value (sample ref or consignment number)
  subtitle?: string; // e.g. entity kind ("Specialty sample" / "Consignment")
  fields: LabelField[];
  footer?: string; // free line, e.g. a consignment's member refs
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
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

const loc = (v: string | null) => formatLocation(v);

/** Build label data from any of the three books' detail rows — the identifying and
 * descriptive fields differ per book (specialty: ref/description/grade, commercial:
 * sample_ref/quality/client, forwarding: sample_ref/coffee_quality), so walk the
 * candidates in priority order like DetailDrawer's title does. */
export function sampleLabelData(row: Record<string, unknown>): LabelData {
  const code = str(row, 'ref') ?? str(row, 'sample_ref') ?? String(row.id ?? '');
  const fields: Array<{ label: string; value: string | null }> = [
    { label: 'Quality', value: str(row, 'quality') ?? str(row, 'description') ?? str(row, 'coffee_quality') },
    { label: 'Grade', value: str(row, 'grade') },
    { label: 'Client', value: str(row, 'client') ?? str(row, 'receiver_company') ?? str(row, 'receiver') ?? str(row, 'name') },
    { label: 'Consignment', value: str(row, 'consignment_number') },
    { label: 'Location', value: loc(str(row, 'consignment_location') ?? str(row, 'location')) },
  ];
  return { code, subtitle: 'Sample', fields: fields.filter((f): f is LabelField => f.value != null) };
}

export function consignmentLabelData(c: {
  number: string;
  location: string | null;
  member_count: number;
  members: Array<{ ref: string | null }>;
}): LabelData {
  const fields: Array<{ label: string; value: string | null }> = [
    { label: 'Location', value: loc(c.location) },
    { label: 'Samples', value: String(c.member_count) },
  ];
  const refs = c.members.map((m) => m.ref).filter(Boolean).join('  ·  ');
  return {
    code: c.number,
    subtitle: 'Consignment',
    fields: fields.filter((f): f is LabelField => f.value != null),
    footer: refs || undefined,
  };
}

// --- Print window --------------------------------------------------------------
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The print window's full document. Exported for tests; openPrintLabel writes it. */
export function labelHtml(label: LabelData): string {
  const rows = label.fields
    .map((f) => `<div class="row"><span class="k">${escapeHtml(f.label)}</span><span class="v">${escapeHtml(f.value)}</span></div>`)
    .join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Label ${escapeHtml(label.code)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; color: #000; background: #f4f4f4;
         display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 16px; }
  .toolbar button { font: inherit; padding: 6px 16px; cursor: pointer; }
  .label { width: 90mm; background: #fff; border: 1px dashed #999; padding: 5mm; }
  .subtitle { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.12em; color: #555; }
  .code { font-size: 20pt; font-weight: 700; letter-spacing: 0.02em; margin: 1mm 0 3mm; }
  .barcode { margin-bottom: 1mm; }
  .barcode-text { font-family: ui-monospace, monospace; font-size: 8pt; letter-spacing: 0.3em; text-align: center; margin-bottom: 3mm; }
  .row { display: flex; gap: 3mm; font-size: 10pt; padding: 0.8mm 0; border-top: 1px solid #ddd; }
  .row .k { width: 24mm; flex: none; text-transform: uppercase; font-size: 7.5pt; letter-spacing: 0.08em; color: #555; padding-top: 1pt; }
  .row .v { font-weight: 600; }
  .footer { margin-top: 2mm; border-top: 1px solid #ddd; padding-top: 1.5mm; font-size: 8pt; color: #333; }
  @media print {
    @page { margin: 5mm; }
    body { background: #fff; padding: 0; display: block; }
    .toolbar { display: none; }
    .label { border: none; padding: 0; }
  }
</style>
</head>
<body>
<div class="toolbar"><button onclick="window.print()">Print</button></div>
<div class="label">
  ${label.subtitle ? `<div class="subtitle">${escapeHtml(label.subtitle)}</div>` : ''}
  <div class="code">${escapeHtml(label.code)}</div>
  <div class="barcode">${code39Svg(label.code)}</div>
  <div class="barcode-text">*${escapeHtml(code39Sanitize(label.code))}*</div>
  ${rows}
  ${label.footer ? `<div class="footer">${escapeHtml(label.footer)}</div>` : ''}
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
