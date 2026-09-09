import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { DhlProvider } from '../src/lib/tracking/dhl.js';
import { TrackingUnavailableError } from '../src/lib/tracking.js';
import { dhlDailyCounter } from '../src/lib/tracking/registry.js';
const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/tracking/${n}.json`, import.meta.url), 'utf8'));
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => { dhlDailyCounter.reset(); delete process.env.TRACKING_DHL_DAILY_CAP; });

describe('DhlProvider', () => {
  const now = new Date('2026-09-08T12:00:00Z');
  it('maps a delivered shipment', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => json(fx('dhl-delivered'))); vi.stubGlobal('fetch', fetchMock);
    const info = await new DhlProvider({ apiKey: 'k' }).track('9620551651', new Date('2026-09-05'), now);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api-eu.dhl.com/track/shipments?trackingNumber=9620551651&service=express');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'DHL-API-Key': 'k' });
    expect(info).toMatchObject({ status: 'delivered', courier: 'dhl', source: 'dhl', delivered_at: '2026-09-08T11:20:00', last_event: 'Delivered - Signed for by: A SOLBERG', location: 'STOCKHOLM - SWEDEN', exception_reason: null, checked_at: now.toISOString() });
  });
  it('maps a customs hold to exception/customs_hold', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json(fx('dhl-customs'))));
    const info = await new DhlProvider({ apiKey: 'k' }).track('9620551651', null, now);
    expect(info).toMatchObject({ status: 'exception', exception_reason: 'customs_hold', location: 'NAIROBI - KENYA' });
  });
  it('404 → unknown, 429 → TrackingUnavailableError, cap → daily_cap', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ detail: 'not found' }, 404)));
    expect((await new DhlProvider({ apiKey: 'k' }).track('1', null, now)).status).toBe('unknown');
    vi.stubGlobal('fetch', vi.fn(() => json({}, 429)));
    await expect(new DhlProvider({ apiKey: 'k' }).track('1', null, now)).rejects.toBeInstanceOf(TrackingUnavailableError);
    process.env.TRACKING_DHL_DAILY_CAP = '0';
    await expect(new DhlProvider({ apiKey: 'k' }).track('1', null, now)).rejects.toMatchObject({ reason: 'daily_cap' });
  });
});
