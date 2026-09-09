import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { DhlProvider } from '../src/lib/tracking/dhl.js';
import { FedexProvider, resetFedexTokenCache } from '../src/lib/tracking/fedex.js';
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

describe('FedexProvider', () => {
  const now = new Date('2026-09-08T12:00:00Z');
  const tokenBody = () => json({ access_token: 'tok', expires_in: 3600 });
  beforeEach(() => resetFedexTokenCache());

  it('fetches the token once and reuses it across two track() calls', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => tokenBody())
      .mockImplementationOnce(() => json(fx('fedex-delivered')))
      .mockImplementationOnce(() => json(fx('fedex-delivered')));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new FedexProvider({ clientId: 'id', clientSecret: 'secret' });
    await provider.track('884926239823', null, now);
    await provider.track('884926239823', null, now);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain('/oauth/token');
    expect(fetchMock.mock.calls[1][0]).toContain('/track/v1/trackingnumbers');
    expect(fetchMock.mock.calls[2][0]).toContain('/track/v1/trackingnumbers');
  });

  it('maps a delivered shipment', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => tokenBody())
      .mockImplementationOnce(() => json(fx('fedex-delivered')));
    vi.stubGlobal('fetch', fetchMock);
    const info = await new FedexProvider({ clientId: 'id', clientSecret: 'secret' }).track('884926239823', null, now);
    expect(info).toMatchObject({
      status: 'delivered', courier: 'fedex', source: 'fedex',
      delivered_at: '2026-09-08T14:05:00+02:00', location: 'HELSINKI, FI',
      exception_reason: null, checked_at: now.toISOString(),
    });
  });

  it('maps a customs delay to exception/customs_hold', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => tokenBody())
      .mockImplementationOnce(() => json(fx('fedex-exception')));
    vi.stubGlobal('fetch', fetchMock);
    const info = await new FedexProvider({ clientId: 'id', clientSecret: 'secret' }).track('884926239824', null, now);
    expect(info).toMatchObject({ status: 'exception', exception_reason: 'customs_hold', location: 'NAIROBI, KE' });
  });

  it('maps a NOTFOUND error to unknown', async () => {
    const notFound = {
      output: { completeTrackResults: [{ trackResults: [{ error: { code: 'TRACKING.TRACKINGNUMBER.NOTFOUND', message: 'Tracking number not found' } }] }] },
    };
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => tokenBody())
      .mockImplementationOnce(() => json(notFound));
    vi.stubGlobal('fetch', fetchMock);
    const info = await new FedexProvider({ clientId: 'id', clientSecret: 'secret' }).track('000000000000', null, now);
    expect(info.status).toBe('unknown');
  });

  it('refreshes the token once on a 401 from track', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => tokenBody())
      .mockImplementationOnce(() => json({}, 401))
      .mockImplementationOnce(() => tokenBody())
      .mockImplementationOnce(() => json(fx('fedex-delivered')));
    vi.stubGlobal('fetch', fetchMock);
    const info = await new FedexProvider({ clientId: 'id', clientSecret: 'secret' }).track('884926239823', null, now);
    expect(info.status).toBe('delivered');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2][0]).toContain('/oauth/token');
  });
});
