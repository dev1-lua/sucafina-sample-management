import { describe, it, expect } from 'vitest';

import { code39Sanitize, code39Svg, sampleLabelData, consignmentLabelData, labelHtml } from './print-label';

/** Reconstruct the bar/space unit string ("1" = ink) from the SVG's rects, so the
 * encoding can be checked against the published Code 39 table. */
function svgToBinary(svg: string): string {
  const width = Number(/viewBox="0 0 (\d+) /.exec(svg)![1]);
  const units = Array.from({ length: width }, () => '0');
  for (const m of svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)"/g)) {
    const x = Number(m[1]);
    for (let i = 0; i < Number(m[2]); i++) units[x + i] = '1';
  }
  return units.join('');
}

// Reference encodings from the standard Code 39 table (wide = 3 narrow units):
const STAR = '100010111011101'; // start/stop '*'
const ZERO = '101000111011101';

describe('code39', () => {
  it('encodes "0" exactly per the published table, framed by start/stop', () => {
    expect(svgToBinary(code39Svg('0'))).toBe(`${STAR}0${ZERO}0${STAR}`);
  });

  it('every character is 15 units wide with a 1-unit inter-character gap', () => {
    // "*SL-8000*" = 9 symbols × 15 units + 8 gaps = 143.
    expect(code39Svg('SL-8000')).toContain('viewBox="0 0 143 44"');
  });

  it('sanitizes to the Code 39 alphabet (uppercase, drops unsupported chars)', () => {
    expect(code39Sanitize('sl-8000')).toBe('SL-8000');
    expect(code39Sanitize('CN#12/34')).toBe('CN1234');
  });
});

// A fixed print day for rows that carry no date: 11 Sep 2026, inside the 2025/2026 season.
const NOW = new Date(2026, 8, 11);

describe('sampleLabelData', () => {
  // Gloria's slips (2026-09-11): the mark, then Stocklot · Outturn · Grower · Screen · Crop, one per line.
  it('a specialty lot prints as the slip: Stocklot, Outturn, Grower, Screen, Crop — in that order', () => {
    const label = sampleLabelData({
      id: 'u-1', ref: 'SL-7408', stocklot: '15/5670', outturn: '13KP0215', name: 'CHERIWET', grade: 'AB',
      crop_year: '2025/2026', description: 'flavor mapping', receiver_company: 'TORCH', location: 'westlands',
    });
    expect(label.code).toBe('SL-7408');
    expect(label.kind).toBe('Specialty sample');
    expect(label.lines).toEqual([
      { label: 'Stocklot', value: '15/5670' },
      { label: 'Outturn', value: '13KP0215' },
      { label: 'Grower', value: 'CHERIWET' },
      { label: 'Screen', value: 'AB' },
      { label: 'Crop', value: '2025/2026' },
      { label: 'Deliver to', value: 'TORCH' },
    ]);
  });

  // Round 10: the same ref goes out to several receivers, so the slip names who this bag is for —
  // last line, right above the barcode. A row with no receiver prints no line.
  it('names the receiver as the last line so two bags with the same ref are distinguishable', () => {
    const lines = (row: Record<string, unknown>) => sampleLabelData({ ref: 'SL-7336', outturn: '08KN0021', ...row }, NOW).lines;
    expect(lines({ receiver_company: 'Sucafina NV' }).at(-1)).toEqual({ label: 'Deliver to', value: 'Sucafina NV' });
    expect(lines({ receiver_company: 'Sucafina NV', sample_type_norm: 'pss', contract_number: 'P-1', option_letter: 'A' }).map((l) => l.label))
      .toEqual(['Outturn', 'Crop', 'Contract', 'Option', 'Deliver to']);
    expect(lines({}).map((l) => l.label)).not.toContain('Deliver to');
    expect(sampleLabelData({ sample_ref: 'TYPE-113', quality: 'AB FAQ', client: 'Paulig' }, NOW).lines.at(-1)).toEqual({ label: 'Deliver to', value: 'Paulig' });
  });

  it('the grower is the wet mill before the "/" of the name, without a leading grade', () => {
    const grower = (row: Record<string, unknown>) => sampleLabelData({ ref: 'SL-1', ...row }).lines.find((l) => l.label === 'Grower')?.value;
    expect(grower({ name: 'KII/KIRINYAGA' })).toBe('KII');
    expect(grower({ name: 'MUTUNGATI /NAKURU' })).toBe('MUTUNGATI');
    expect(grower({ name: 'AA SANGALAI', grade: 'AA' })).toBe('SANGALAI');
    expect(grower({ name: 'AB SWARA', grade: 'AA' })).toBe('AB SWARA');
  });

  it('skips the lot lines a row does not have; a row with none of them names its description', () => {
    expect(sampleLabelData({ ref: 'SL-7266', outturn: '08KN0022', name: 'KII/KIRINYAGA', grade: 'AA' }, NOW).lines).toEqual([
      { label: 'Outturn', value: '08KN0022' },
      { label: 'Grower', value: 'KII' },
      { label: 'Screen', value: 'AA' },
      { label: 'Crop', value: '2025/2026' },
    ]);
    expect(sampleLabelData({ ref: 'SL-7459', description: 'Walk-in AA' }, NOW).lines).toEqual([
      { label: 'Description', value: 'Walk-in AA' },
      { label: 'Crop', value: '2025/2026' },
    ]);
  });

  // Decision 2026-09-11: no crop year on file → the season the sample was logged in (Kenya: Oct → Sep).
  it("no crop year saved: Crop prints the coffee season of the sample's date; a saved one wins", () => {
    const crop = (row: Record<string, unknown>, now = NOW) =>
      sampleLabelData({ ref: 'SL-1', outturn: '08KN0021', ...row }, now).lines.find((l) => l.label === 'Crop')?.value;
    expect(crop({ date_on: '2026-09-11' })).toBe('2025/2026');
    expect(crop({ date_on: '2026-09-30' })).toBe('2025/2026');
    expect(crop({ date_on: '2026-10-01' })).toBe('2026/2027');
    expect(crop({ date: '2026-01-15' })).toBe('2025/2026'); // the verbatim date when date_on is absent
    expect(crop({}, new Date(2026, 9, 5))).toBe('2026/2027'); // no date on the row → the print day's season
    expect(crop({ date_on: '2026-10-01', crop_year: '2024/2025' })).toBe('2024/2025');
    // Commercial samples carry a crop year too; forwarding parcels don't.
    expect(sampleLabelData({ sample_ref: 'TYPE-1', quality: 'AB', date_on: '2026-09-11' }, NOW).lines).toContainEqual({ label: 'Crop', value: '2025/2026' });
    expect(sampleLabelData({ sample_ref: 'FW-1', coffee_quality: 'Robusta', sender: 'X' }, NOW).lines.map((l) => l.label)).not.toContain('Crop');
  });

  it('a specialty PSS adds its contract and option after the slip lines', () => {
    const label = sampleLabelData({
      ref: 'SSKE-4411A', outturn: '08KN0021', name: 'KII', grade: 'AB', sample_type_norm: 'pss',
      contract_number: 'P-4411', option_letter: 'A',
    }, NOW);
    expect(label.kind).toBe('Specialty sample · PSS');
    expect(label.lines.map((l) => `${l.label}: ${l.value}`)).toEqual([
      'Outturn: 08KN0021', 'Grower: KII', 'Screen: AB', 'Crop: 2025/2026', 'Contract: P-4411', 'Option: A',
    ]);
  });

  it('a commercial sample leads with its ref: Ref, Quality, Crop, then who it goes to', () => {
    const label = sampleLabelData({
      id: 'u-2', sample_ref: 'TYPE-8121', quality: 'AB FAQ', client: 'Paulig', crop_year: '2025/2026',
      consignment_number: 'CN-1001', consignment_location: 'thika',
    });
    expect(label.code).toBe('TYPE-8121');
    expect(label.kind).toBe('Commercial sample');
    expect(label.lines).toEqual([
      { label: 'Ref', value: 'TYPE-8121' },
      { label: 'Quality', value: 'AB FAQ' },
      { label: 'Crop', value: '2025/2026' },
      { label: 'Deliver to', value: 'Paulig' },
    ]);
  });

  it('a commercial PSS carries contract, option and shipment; a pre-letter row shows its slot', () => {
    const label = sampleLabelData({
      id: 'u-4', sample_ref: 'SSKE-77812C', quality: 'AB FAQ', sample_type_norm: 'pss',
      contract_number: 'P-77812', container_no: 3, option_letter: 'C', shipment_month: 'Nov', client: 'Paulig',
    }, NOW);
    expect(label.kind).toBe('Commercial sample · PSS');
    expect(label.lines).toEqual([
      { label: 'Ref', value: 'SSKE-77812C' },
      { label: 'Contract', value: 'P-77812' },
      { label: 'Option', value: 'C' },
      { label: 'Quality', value: 'AB FAQ' },
      { label: 'Shipment', value: 'Nov' },
      { label: 'Crop', value: '2025/2026' },
      { label: 'Deliver to', value: 'Paulig' },
    ]);
    expect(sampleLabelData({ sample_ref: 'SSKE-9001', sample_type_norm: 'pss', contract_number: 'P-1', container_no: 3 }).lines)
      .toContainEqual({ label: 'Option', value: '3' });
  });

  it('a forwarding parcel prints Ref, Quality, Client', () => {
    const label = sampleLabelData({ sample_ref: 'UGF/26/1', coffee_quality: 'Robusta', id_number: 'ID-9', sender: 'X', receiver_company: 'Itochu' });
    expect(label.kind).toBe('Forwarding parcel');
    expect(label.lines).toEqual([
      { label: 'Ref', value: 'UGF/26/1' },
      { label: 'Quality', value: 'Robusta' },
      { label: 'Client', value: 'Itochu' },
    ]);
  });

  it('derives the book from `tab` when present', () => {
    expect(sampleLabelData({ tab: 'forwarding', ref: 'FW-1' }).kind).toBe('Forwarding parcel');
    expect(sampleLabelData({ tab: 'bulk', ref: 'SL-1', sample_type_norm: 'pss' }).kind).toBe('Commercial sample · PSS');
  });

  it('falls back to the row id when no ref exists', () => {
    expect(sampleLabelData({ id: 'abc-123' }).code).toBe('abc-123');
  });
});

describe('consignmentLabelData', () => {
  it('carries number, location, member count and a member-ref footer', () => {
    const label = consignmentLabelData({
      number: 'CN-1002', location: 'westlands', member_count: 2,
      members: [{ ref: 'SL-8000' }, { ref: null }, { ref: 'TYPE-8121' }],
    });
    expect(label.code).toBe('CN-1002');
    expect(label.kind).toBe('Consignment');
    expect(label.lines).toEqual([
      { label: 'Consignment', value: 'CN-1002' },
      { label: 'Location', value: 'Westlands' },
      { label: 'Samples', value: '2' },
    ]);
    expect(label.footer).toBe('SL-8000 | TYPE-8121');
  });

  it('footer lists ref · outturn, or ref · contract for a PSS, falling back to the bare ref', () => {
    const label = consignmentLabelData({
      number: 'CN-1003', location: null, member_count: 3,
      members: [
        { ref: 'SL-8000', outturn: '123/45' },
        { ref: 'SSKE-9001', sample_type_norm: 'pss', contract_number: 'P-77812' },
        { ref: 'TYPE-8121', sample_type_norm: 'type', contract_number: 'P-1' },
      ],
    });
    expect(label.footer).toBe('SL-8000 · 123/45 | SSKE-9001 · P-77812 | TYPE-8121');
  });
});

describe('labelHtml', () => {
  const slip = {
    code: 'SL-7408',
    kind: 'Specialty sample',
    lines: [
      { label: 'Stocklot', value: '15/5670' },
      { label: 'Outturn', value: '13KP0215' },
    ],
  };

  it('prints each line as "Label: value", escapes markup, and opens the print dialog', () => {
    const html = labelHtml({ ...slip, lines: [...slip.lines, { label: 'Grower', value: '<b>Acme & Co</b>' }] });
    expect(html).toContain('<div class="line"><span class="k">Stocklot:</span> <span class="v">15/5670</span></div>');
    expect(html).toContain('&lt;b&gt;Acme &amp; Co&lt;/b&gt;');
    expect(html).not.toContain('<b>Acme');
    expect(html).toContain('window.print()');
  });

  it('the Kenyacof mark heads the slip, then the lines, then the barcode strip with its ref and kind', () => {
    const html = labelHtml(slip);
    expect(html).toContain('aria-label="Kenyacof"');
    expect(html).not.toContain('SUCAFINA'); // the placeholder wordmark is gone
    const mark = html.indexOf('class="mark"');
    const lines = html.indexOf('class="lines"');
    const barcode = html.indexOf('class="barcode"');
    expect(mark).toBeGreaterThan(-1);
    expect(mark).toBeLessThan(lines);
    expect(lines).toBeLessThan(barcode);
    expect(html).toContain('<div class="ref">SL-7408 · Specialty sample</div>');
  });

  it('a consignment footer lists its members under the barcode', () => {
    const html = labelHtml({ code: 'CN-1002', kind: 'Consignment', lines: [], footer: 'SL-8000 | TYPE-8121' });
    expect(html.indexOf('class="barcode"')).toBeLessThan(html.indexOf('class="members"'));
    expect(html).toContain('<div class="members">SL-8000 | TYPE-8121</div>');
  });
});
