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

describe('sampleLabelData', () => {
  it('maps a commercial (bulk) row: sample_ref / quality / client / consignment', () => {
    const label = sampleLabelData({
      id: 'u-1', sample_ref: 'TYPE-8121', quality: 'AB FAQ', client: 'Paulig',
      consignment_number: 'CN-1001', consignment_location: 'thika',
    });
    expect(label.code).toBe('TYPE-8121');
    expect(label.subtitle).toBe('Commercial sample');
    expect(label.headline2).toBeUndefined();
    expect(label.fields).toEqual([
      { label: 'Quality', value: 'AB FAQ' },
      { label: 'Client', value: 'Paulig' },
      { label: 'Consignment', value: 'CN-1001' },
      { label: 'Location', value: 'Thika' },
    ]);
  });

  it('maps a specialty row: ref / description / grade / receiver, skipping empties', () => {
    const label = sampleLabelData({ id: 'u-2', ref: 'SL-8000', description: 'Kirinyaga', grade: 'AA', receiver_company: 'Solberg', location: null });
    expect(label.code).toBe('SL-8000');
    expect(label.subtitle).toBe('Specialty sample');
    expect(label.fields).toEqual([
      { label: 'Quality', value: 'Kirinyaga' },
      { label: 'Grade', value: 'AA' },
      { label: 'Client', value: 'Solberg' },
    ]);
  });

  it('specialty: the outturn is the second headline and is not repeated in the fields', () => {
    const label = sampleLabelData({
      id: 'u-3', ref: 'SL-8010', description: 'Nyeri', grade: 'AB', outturn: '123/45', shipment_month: 'Oct', receiver_company: 'Solberg',
    });
    expect(label.headline2).toEqual({ label: 'OUTTURN', value: '123/45' });
    expect(label.fields.map((f) => f.label)).toEqual(['Quality', 'Grade', 'Shipment month', 'Client']);
  });

  it('PSS: the contract (+ container) is the second headline, subtitle says PSS, neither is repeated', () => {
    const label = sampleLabelData({
      id: 'u-4', sample_ref: 'SSKE-9001', quality: 'AB FAQ', sample_type_norm: 'pss',
      contract_number: 'P-77812', container_no: 3, shipment_month: 'Nov', client: 'Paulig',
    });
    expect(label.subtitle).toBe('Commercial sample · PSS');
    expect(label.headline2).toEqual({ label: 'CONTRACT', value: 'P-77812 · CTR 3' });
    expect(label.fields).toEqual([
      { label: 'Quality', value: 'AB FAQ' },
      { label: 'Shipment month', value: 'Nov' },
      { label: 'Client', value: 'Paulig' },
    ]);
  });

  it('non-PSS commercial rows keep contract and container as ordinary fields', () => {
    const label = sampleLabelData({ sample_ref: 'SL-9002', quality: 'AA', sample_type_norm: 'offer', contract_number: 'P-1', container_no: 2 });
    expect(label.headline2).toBeUndefined();
    expect(label.fields).toEqual([
      { label: 'Quality', value: 'AA' },
      { label: 'Contract #', value: 'P-1' },
      { label: 'Container', value: '2' },
    ]);
  });

  it('derives the book from `tab` when present, else from the forwarding-only columns', () => {
    expect(sampleLabelData({ tab: 'forwarding', ref: 'FW-1' }).subtitle).toBe('Forwarding parcel');
    expect(sampleLabelData({ sample_ref: 'FW-2', coffee_quality: 'Sidamo', id_number: 'ID-9', sender: 'Addis' }).subtitle).toBe('Forwarding parcel');
    expect(sampleLabelData({ tab: 'bulk', ref: 'SL-1', sample_type_norm: 'pss' }).subtitle).toBe('Commercial sample · PSS');
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
    expect(label.fields).toEqual([
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
  it('renders code, fields, barcode and escapes markup in values', () => {
    const html = labelHtml({
      code: 'SL-8000',
      subtitle: 'Sample',
      fields: [{ label: 'Client', value: '<b>Acme & Co</b>' }],
    });
    expect(html).toContain('<div class="code">SL-8000</div>');
    expect(html).toContain('&lt;b&gt;Acme &amp; Co&lt;/b&gt;');
    expect(html).not.toContain('<b>Acme');
    expect(html).toContain('<svg');
    expect(html).toContain('window.print()');
  });

  it('inlines the Sucafina wordmark ahead of the barcode (two SVGs) and the second headline', () => {
    const html = labelHtml({
      code: 'SL-8010',
      subtitle: 'Specialty sample',
      headline2: { label: 'OUTTURN', value: '123/45' },
      fields: [],
    });
    expect(html.match(/<svg/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).toContain('SUCAFINA');
    expect(html.indexOf('class="logo"')).toBeLessThan(html.indexOf('class="barcode"'));
    expect(html).toContain('<div class="headline2"><span class="k">OUTTURN</span><span class="v">123/45</span></div>');
  });
});
