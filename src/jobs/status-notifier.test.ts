import { describe, it, expect } from 'vitest';
import { courierLabel, traderMessage } from './status-notifier.job';
import type { OutboxItem } from '../lib/change-alerts';

const item = (o: Partial<OutboxItem>): OutboxItem =>
  ({
    outbox_id: 'o1', tab: 'specialty', sample_id: 's1', event: 'awb_added', recipient: null,
    ref: 'SL-7461', title: 'AB FAQ', receiver: 'Baba Coffee', status: 'preparing',
    courier_norm: 'dhl', awb: '1234567890', qty_grams: 300, priority: 'normal',
    requested_by: 'Ivo', logged_by: 'Ivo', client_name: 'Baba Coffee', created_at: '2026-09-14T09:00:00Z',
    recipients: [], awaiting_collection: true,
    ...o,
  }) as OutboxItem;

describe('traderMessage — the sketch wording', () => {
  it('AWB added: names the sample, the client and the courier, and says it is on its way soon', () => {
    const { text, subject } = traderMessage(item({}));
    expect(text).toBe('Your sample SL-7461 (AB FAQ) for Baba Coffee has a DHL AWB 1234567890 — it\'ll be on its way soon.');
    expect(subject).toBe('Sample SL-7461: AWB added');
  });

  it('AWB added falls back to the receiver when the row has no client book entry', () => {
    const { text } = traderMessage(item({ client_name: null, receiver: 'Walk-in Roasters' }));
    expect(text).toContain('for Walk-in Roasters has a DHL AWB');
  });

  it('AWB typed after the dispatch never says "soon" — the parcel already left', () => {
    const { text } = traderMessage(item({ status: 'dispatched', awaiting_collection: false }));
    expect(text).toBe('SL-7461 (AB FAQ) for Baba Coffee is on its way — DHL AWB 1234567890.');
  });

  it('dispatched: on its way with courier and AWB', () => {
    const { text, subject } = traderMessage(item({ event: 'dispatched', status: 'dispatched', courier_norm: 'fedex', awb: '7788' }));
    expect(text).toBe('SL-7461 (AB FAQ) for Baba Coffee is on its way — FedEx AWB 7788.');
    expect(subject).toBe('Sample SL-7461: dispatched');
  });

  it('dispatched without an AWB says so instead of inventing one', () => {
    const { text } = traderMessage(item({ event: 'dispatched', status: 'dispatched', courier_norm: 'rider', awb: null }));
    expect(text).toBe('SL-7461 (AB FAQ) for Baba Coffee is on its way — rider, no AWB yet.');
  });

  it('preparing wording is unchanged', () => {
    const { text } = traderMessage(item({ event: 'preparing', status: 'preparing' }));
    expect(text).toBe('Your sample SL-7461 (AB FAQ → Baba Coffee) is being prepared by the lab.');
  });
});

describe('courierLabel', () => {
  it('spells every normalised courier the desk uses', () => {
    expect(['dhl', 'fedex', 'ups', 'rider', 'hand_delivery', 'client_pickup', 'wells_fargo', null].map(courierLabel))
      .toEqual(['DHL', 'FedEx', 'UPS', 'rider', 'hand delivery', 'client pickup', 'Wells Fargo', 'courier']);
  });
});
