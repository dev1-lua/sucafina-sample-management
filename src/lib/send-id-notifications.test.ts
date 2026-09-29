import { describe, it, expect } from 'vitest';
import { changeAlertMessage, type OutboxItem } from './change-alerts';
import { formatReminder } from './reminder-format';
import { dispatchEmail, feedbackChaserEmail } from './client-email';

// Round 11: every notification that quotes a ref quotes the row's Send ID after it — "SL-7336 (SS-1234)" —
// when the row carries one, and reads exactly as before when it does not (the API rows that feed these
// formatters gain send_id per book; the outbox / reminder selects may lag, so absence must be harmless).

const outbox = (o: Partial<OutboxItem>): OutboxItem => ({
  outbox_id: 'o1', tab: 'specialty', sample_id: 's1', event: 'deleted', recipient: null, ref: 'SL-7336', title: 'AA Sangalai',
  receiver: 'TORCH', status: 'requested', courier_norm: null, awb: null, qty_grams: 300, priority: null, requested_by: 'Ivo',
  logged_by: 'Ivo', client_name: 'TORCH', created_at: '2026-09-29T08:00:00Z', recipients: [], actor: 'Ivo', payload: {}, ...o,
} as OutboxItem);

describe('change alerts', () => {
  it('DELETED / EDITED lines quote "ref (SS-n)" when the row has a send_id, the bare ref otherwise', () => {
    const { text } = changeAlertMessage([
      outbox({ send_id: 'SS-1234' }),
      outbox({ outbox_id: 'o2', event: 'request_edited', ref: 'TYPE-980', send_id: 'SS-1235', payload: { changes: { qty_grams: { from: 300, to: 500 } } } } as Partial<OutboxItem>),
      outbox({ outbox_id: 'o3', ref: 'TYPE-981' }),
    ]);
    expect(text).toContain('DELETED SL-7336 (SS-1234) — ');
    expect(text).toContain('EDITED TYPE-980 (SS-1235) — ');
    expect(text).toContain('DELETED TYPE-981 — ');
  });
});

describe('reminder lines', () => {
  it('lead with "ref (SS-n)" when the item carries send_id', () => {
    const text = formatReminder('Awaiting AWB', 2, [
      { tab: 'specialty', id: 'a', ref: 'SL-7336', send_id: 'SS-1234', title: 'AA', receiver: 'TORCH', awb: null, courier_norm: null, status: 'requested', created_at: null, delivery_on: null },
      { tab: 'bulk', id: 'b', ref: 'TYPE-980', title: 'AB FAQ', receiver: 'EDMAX', awb: null, courier_norm: null, status: 'requested', created_at: null, delivery_on: null },
    ]);
    expect(text).toBe('**Awaiting AWB (2)**\n- SL-7336 (SS-1234) — AA → TORCH\n- TYPE-980 — AB FAQ → EDMAX');
  });
});

describe('client emails', () => {
  const base = { tab: 'bulk', id: 'b1', title: 'AB FAQ', client_name: 'EDMAX', email: 'qc@edmax.example' };
  it('dispatch confirmation lists each ref with its Send ID', () => {
    const { html, refs } = dispatchEmail([
      { ...base, ref: 'TYPE-980', send_id: 'SS-1234', receiver: 'EDMAX', courier_norm: 'dhl', awb: '1', qty_grams: 300, dispatched_on: '2026-09-29' },
      { ...base, id: 'b2', ref: 'TYPE-981', receiver: 'EDMAX', courier_norm: 'dhl', awb: '1', qty_grams: 300, dispatched_on: '2026-09-29' },
    ]);
    expect(html).toContain('<strong>TYPE-980 (SS-1234)</strong> — AB FAQ (300 g)');
    expect(html).toContain('<strong>TYPE-981</strong> — AB FAQ (300 g)');
    expect(refs).toEqual(['TYPE-980', 'TYPE-981']);
  });
  it('feedback chaser lists each ref with its Send ID', () => {
    const { html } = feedbackChaserEmail([{ ...base, ref: 'TYPE-980', send_id: 'SS-1234', delivery_on: '2026-09-20' }]);
    expect(html).toContain('<strong>TYPE-980 (SS-1234)</strong> — AB FAQ (delivered 2026-09-20)');
  });
});
