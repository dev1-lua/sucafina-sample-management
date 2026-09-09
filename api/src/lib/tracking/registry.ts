import { StubTrackingProvider, type TrackingProvider } from '../tracking.js';

export type TrackedCourier = 'dhl' | 'fedex';

function normalize(courierNorm: string | null | undefined): TrackedCourier | null {
  if (!courierNorm) return null;
  const c = courierNorm.trim().toLowerCase();
  if (c === 'dhl') return 'dhl';
  if (c === 'fedex') return 'fedex';
  return null;
}

function stubOrNull(): TrackingProvider | null {
  const nodeEnv = process.env.NODE_ENV;
  const fallback = process.env.TRACKING_STUB_FALLBACK === 'true';
  if (nodeEnv !== 'production' || fallback) return new StubTrackingProvider();
  return null;
}

const overrides: Partial<Record<TrackedCourier, TrackingProvider | null | undefined>> = {};

/** Overrides providerFor: a provider forces it, `null` forces "no provider", `undefined` clears the override. */
export function setProviderForTests(courier: TrackedCourier | 'all', p: TrackingProvider | null | undefined): void {
  if (courier === 'all') {
    overrides.dhl = p;
    overrides.fedex = p;
    return;
  }
  overrides[courier] = p;
}

export function providerFor(courierNorm: string | null | undefined): TrackingProvider | null {
  const c = normalize(courierNorm);
  if (!c) return null;
  if (overrides[c] !== undefined) return overrides[c] ?? null;

  if (c === 'dhl') {
    if (process.env.DHL_API_KEY) {
      return null; // filled in by Task 4.2/4.3 — real DhlProvider construction
    }
    return stubOrNull();
  }

  // c === 'fedex'
  if (process.env.FEDEX_CLIENT_ID && process.env.FEDEX_CLIENT_SECRET) {
    return null; // filled in by Task 4.2/4.3 — real FedexProvider construction
  }
  return stubOrNull();
}

export function notConfiguredNote(courier: TrackedCourier): string {
  const label = courier === 'dhl' ? 'DHL' : 'FedEx';
  return `live tracking not configured for ${label}`;
}

export function guessCourier(awb: string): TrackedCourier | null {
  if (!/^\d+$/.test(awb)) return null;
  const len = awb.length;
  if (len === 10) return 'dhl';
  if (len === 12 || len === 15 || len === 20 || len === 22) return 'fedex';
  return null;
}

export const dhlDailyCounter: { take(now?: Date): boolean; reset(): void } = (() => {
  let day: string | null = null;
  let count = 0;
  const utcDay = (d: Date): string => d.toISOString().slice(0, 10);
  return {
    take(now: Date = new Date()): boolean {
      const cap = Number(process.env.TRACKING_DHL_DAILY_CAP ?? '200');
      const today = utcDay(now);
      if (today !== day) {
        day = today;
        count = 0;
      }
      if (count >= cap) return false;
      count++;
      return true;
    },
    reset(): void {
      day = null;
      count = 0;
    },
  };
})();
