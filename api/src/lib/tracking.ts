export type TrackingInfo = {
  awb: string;
  status: 'in_transit' | 'delivered';
  eta: string | null;
  delivered_at: string | null;
  note: string;
};

export interface TrackingProvider {
  track(awb: string, dispatchedAt: Date | null, now?: Date): TrackingInfo;
}

function hashAwb(awb: string): number {
  let h = 0;
  for (const c of awb) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const DAY = 86_400_000;

export class StubTrackingProvider implements TrackingProvider {
  track(awb: string, dispatchedAt: Date | null, now: Date = new Date()): TrackingInfo {
    const h = hashAwb(awb);
    const transitDays = 2 + (h % 5); // 2..6 days, stable per AWB
    const start = dispatchedAt ?? new Date(now.getTime() - (h % 10) * DAY);
    const arrival = new Date(start.getTime() + transitDays * DAY);
    if (now.getTime() >= arrival.getTime()) {
      return { awb, status: 'delivered', eta: null, delivered_at: arrival.toISOString(),
               note: `Delivered after ${transitDays} days in transit (stub data)` };
    }
    const daysLeft = Math.ceil((arrival.getTime() - now.getTime()) / DAY);
    return { awb, status: 'in_transit', eta: arrival.toISOString(), delivered_at: null,
             note: `In transit, ~${daysLeft} day(s) to arrival (stub data)` };
  }
}
