import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { providerFor, guessCourier, setProviderForTests, dhlDailyCounter, notConfiguredNote } from '../src/lib/tracking/registry.js';
import { StubTrackingProvider } from '../src/lib/tracking.js';

beforeEach(() => { setProviderForTests('all', undefined); dhlDailyCounter.reset(); delete process.env.DHL_API_KEY; delete process.env.FEDEX_CLIENT_ID; delete process.env.FEDEX_CLIENT_SECRET; process.env.TRACKING_STUB_FALLBACK = 'true'; process.env.NODE_ENV = 'test'; });

// vitest runs single-threaded (fileParallelism:false) with a shared process.env — anything a test
// sets here must be cleared, or it leaks into whichever test file runs next (e.g. a future
// tracking-sweep test that relies on the default 200 cap).
afterEach(() => {
  delete process.env.TRACKING_DHL_DAILY_CAP;
  delete process.env.DHL_API_KEY;
  delete process.env.FEDEX_CLIENT_ID;
  delete process.env.FEDEX_CLIENT_SECRET;
  process.env.TRACKING_STUB_FALLBACK = 'true';
  process.env.NODE_ENV = 'test';
});

describe('registry', () => {
  it('guesses the courier from the AWB shape', () => {
    expect(guessCourier('9620551651')).toBe('dhl');
    expect(guessCourier('771234567890')).toBe('fedex');
    expect(guessCourier('TRK999')).toBeNull();
  });
  it('returns the stub outside production without keys, null in production without keys', () => {
    expect(providerFor('dhl')?.name).toBe('stub');
    process.env.NODE_ENV = 'production'; process.env.TRACKING_STUB_FALLBACK = 'false';
    expect(providerFor('dhl')).toBeNull();
    expect(notConfiguredNote('dhl')).toBe('live tracking not configured for DHL');
  });
  it('returns the real providers when keys exist, null for untracked couriers', () => {
    process.env.DHL_API_KEY = 'k'; expect(providerFor('dhl')?.name).toBe('dhl');
    process.env.FEDEX_CLIENT_ID = 'a'; process.env.FEDEX_CLIENT_SECRET = 'b'; expect(providerFor('FedEx')?.name).toBe('fedex');
    for (const c of ['ups', 'rider', 'hand_delivery', 'client_pickup', 'wells_fargo', 'other', null, 'DHL Express via Kiptoo']) expect(providerFor(c)).toBeNull();
  });
  it('setProviderForTests wins', () => { const p = new StubTrackingProvider(); setProviderForTests('dhl', p); expect(providerFor('dhl')).toBe(p); });
  it('daily counter caps at TRACKING_DHL_DAILY_CAP', () => {
    process.env.TRACKING_DHL_DAILY_CAP = '2';
    expect(dhlDailyCounter.take()).toBe(true); expect(dhlDailyCounter.take()).toBe(true); expect(dhlDailyCounter.take()).toBe(false);
    expect(dhlDailyCounter.take(new Date(Date.now() + 86_400_000))).toBe(true); // new UTC day resets
  });
  it('does not leave TRACKING_DHL_DAILY_CAP (or the other env this file sets) leaked for later tests', () => {
    // This test must run after the one above sets TRACKING_DHL_DAILY_CAP='2' — the afterEach is
    // what's actually under test here: beforeEach doesn't touch TRACKING_DHL_DAILY_CAP at all.
    expect(process.env.TRACKING_DHL_DAILY_CAP).toBeUndefined();
    expect(process.env.DHL_API_KEY).toBeUndefined();
    expect(process.env.FEDEX_CLIENT_ID).toBeUndefined();
    expect(process.env.FEDEX_CLIENT_SECRET).toBeUndefined();
    expect(process.env.TRACKING_STUB_FALLBACK).toBe('true');
    expect(process.env.NODE_ENV).toBe('test');
  });
  it('falls back to the default cap (200) when TRACKING_DHL_DAILY_CAP is not a valid number', () => {
    process.env.TRACKING_DHL_DAILY_CAP = 'not-a-number';
    for (let i = 0; i < 200; i++) expect(dhlDailyCounter.take()).toBe(true);
    expect(dhlDailyCounter.take()).toBe(false);
  });
});

describe('migration 019', () => {
  it('adds the five tracking columns to all three books, idempotently', async () => {
    const { resetDb, reapplyMigrationsFrom } = await import('./helpers.js'); const { pool } = await import('../src/db.js');
    await resetDb(); await reapplyMigrationsFrom('019');
    for (const t of ['specialty_samples', 'bulk_samples', 'forwarding_samples']) {
      const { rows } = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name LIKE 'tracking_%' ORDER BY 1`, [t]);
      expect(rows.map((r) => r.column_name)).toEqual(['tracking_checked_at', 'tracking_exception', 'tracking_last_event', 'tracking_last_event_at', 'tracking_status']);
    }
  });
});
