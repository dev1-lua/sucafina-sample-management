export type TrackingStatus = 'pre_transit' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'unknown';
export type ExceptionReason = 'customs_hold' | 'address_problem' | 'returned' | 'refused' | 'damaged' | 'other';
export type TrackingSource = 'dhl' | 'fedex' | 'stub' | 'none';

export type TrackingInfo = {
  awb: string;
  courier: 'dhl' | 'fedex' | null;
  status: TrackingStatus;
  exception_reason: ExceptionReason | null;
  last_event: string | null;
  last_event_at: string | null;
  location: string | null;
  eta: string | null;
  delivered_at: string | null;
  note: string;
  source: TrackingSource;
  checked_at: string;
};

export interface TrackingProvider {
  readonly name: TrackingSource;
  track(awb: string, dispatchedAt: Date | null, now?: Date): Promise<TrackingInfo>;
}

/** Thrown for 429 / 5xx / network / daily cap: the caller must leave tracking_checked_at stale. */
export class TrackingUnavailableError extends Error {
  constructor(public reason: 'rate_limited' | 'daily_cap' | 'upstream' | 'auth', message: string) {
    super(message);
  }
}

function hashAwb(awb: string): number {
  let h = 0;
  for (const c of awb) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const DAY = 86_400_000;

export class StubTrackingProvider implements TrackingProvider {
  name = 'stub' as const;

  async track(awb: string, dispatchedAt: Date | null, now: Date = new Date()): Promise<TrackingInfo> {
    const h = hashAwb(awb);
    const transitDays = 2 + (h % 5); // 2..6 days, stable per AWB
    const start = dispatchedAt ?? new Date(now.getTime() - (h % 10) * DAY);
    const arrival = new Date(start.getTime() + transitDays * DAY);
    const checked_at = now.toISOString();
    if (now.getTime() >= arrival.getTime()) {
      return {
        awb, courier: null, status: 'delivered', exception_reason: null,
        last_event: 'Delivered', last_event_at: arrival.toISOString(), location: null,
        eta: null, delivered_at: arrival.toISOString(),
        note: `Delivered after ${transitDays} days in transit`,
        source: 'stub', checked_at,
      };
    }
    const daysLeft = Math.ceil((arrival.getTime() - now.getTime()) / DAY);
    return {
      awb, courier: null, status: 'in_transit', exception_reason: null,
      last_event: 'In transit', last_event_at: checked_at, location: null,
      eta: arrival.toISOString(), delivered_at: null,
      note: `In transit, ~${daysLeft} day(s) to arrival`,
      source: 'stub', checked_at,
    };
  }
}

export const unknownInfo = (
  awb: string,
  courier: TrackingInfo['courier'],
  note: string,
  now: Date = new Date(),
): TrackingInfo => ({
  awb, courier, status: 'unknown', exception_reason: null, last_event: null, last_event_at: null,
  location: null, eta: null, delivered_at: null, note, source: 'none', checked_at: now.toISOString(),
});
