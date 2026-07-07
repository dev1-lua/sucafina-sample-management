export function parseQtyGrams(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Math.round(raw);
  const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)\s*(kg|g)?/i);
  if (!m || m[1] === undefined) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  return (m[2] ?? '').toLowerCase() === 'kg' ? Math.round(n * 1000) : Math.round(n);
}

export function normalizeCourier(raw: unknown): string | null {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (s.includes('dhl')) return 'dhl';
  if (s.includes('fedex') || s.includes('fed ex')) return 'fedex';
  if (s.includes('ups')) return 'ups';
  if (s.includes('kiptoo') || s.includes('rider')) return 'rider';
  if (s === 'hd' || s === 'h/d' || s.includes('hand')) return 'hand_delivery';
  if (s.includes('picked')) return 'client_pickup';
  return 'other';
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function classifySampleType(raw: unknown): { type: string; shipmentMonth: string | null } {
  if (raw == null) return { type: 'other', shipmentMonth: null };
  const s = String(raw).toLowerCase();
  let shipmentMonth: string | null = null;
  for (const m of MONTHS) {
    const abbr = m.slice(0, 3).toLowerCase();
    if (new RegExp(`\\b${abbr}[a-z]*\\b`).test(s)) { shipmentMonth = m; break; }
  }
  if (s.includes('pss')) return { type: 'pss', shipmentMonth };
  if (s.includes('type')) return { type: 'type', shipmentMonth: null };
  if (s.includes('offer')) return { type: 'offer', shipmentMonth: null };
  if (s.includes('woc')) return { type: 'woc', shipmentMonth: null };
  if (s.includes('flavor') || s.includes('flavour')) return { type: 'flavor_mapping', shipmentMonth: null };
  if (s.includes('marketing')) return { type: 'marketing', shipmentMonth: null };
  if (s.includes('calibration')) return { type: 'calibration', shipmentMonth: null };
  if (s.includes('retention')) return { type: 'retention', shipmentMonth: null };
  return { type: 'other', shipmentMonth: null };
}

export function parseSheetDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (v == null) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return null;
}

export function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseResult(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'approved') return 'approved';
  if (s === 'rejected') return 'rejected';
  return null;
}
