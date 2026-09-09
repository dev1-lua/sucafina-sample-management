import {
  TrackingUnavailableError,
  unknownInfo,
  type ExceptionReason,
  type TrackingInfo,
  type TrackingProvider,
} from '../tracking.js';
import { dhlDailyCounter } from './registry.js';
import { reasonFromText } from './reasons.js';

type DhlAddress = { addressLocality?: string | null };
type DhlLocation = { address?: DhlAddress | null };
type DhlEvent = { timestamp?: string; location?: DhlLocation | null; statusCode?: string; description?: string };
type DhlStatus = {
  timestamp?: string;
  location?: DhlLocation | null;
  statusCode?: string;
  status?: string;
  description?: string;
  remark?: string;
};
type DhlShipment = {
  id?: string;
  status?: DhlStatus;
  estimatedTimeOfDelivery?: string;
  events?: DhlEvent[];
};
type DhlResponse = { shipments?: DhlShipment[] };

const STATUS_CODE_MAP: Record<string, TrackingInfo['status']> = {
  'pre-transit': 'pre_transit',
  transit: 'in_transit',
  delivered: 'delivered',
  failure: 'exception',
  unknown: 'unknown',
};

// A shipment reported as `transit` flips to `exception` only when the combined text carries an
// actual hold signal AND doesn't also say the hold is over — otherwise routine text like
// "Clearance processing complete at NAIROBI - KENYA" (which contains the word "clearance") would
// wrongly raise a customs-hold alert to QC and the account manager.
const HOLD_SIGNAL =
  /\bon hold\b|\bheld\b|customs (hold|delay)|clearance (delay|hold|event|status)|awaiting .*clearance|address (problem|incorrect|incomplete)|refused|return(ed)? to (sender|shipper)|damaged/i;
const HOLD_RESOLVED = /complete|cleared|released/i;

export class DhlProvider implements TrackingProvider {
  name = 'dhl' as const;
  private apiKey: string;
  private fetchImpl: typeof fetch;
  private base: string;

  constructor(o: { apiKey: string; fetchImpl?: typeof fetch; base?: string }) {
    this.apiKey = o.apiKey;
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.base = o.base ?? 'https://api-eu.dhl.com';
  }

  async track(awb: string, _dispatchedAt: Date | null, now: Date = new Date()): Promise<TrackingInfo> {
    if (!dhlDailyCounter.take(now)) {
      throw new TrackingUnavailableError('daily_cap', 'DHL daily tracking cap reached');
    }

    const url = `${this.base}/track/shipments?trackingNumber=${awb}&service=express`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: { 'DHL-API-Key': this.apiKey, Accept: 'application/json' } });
    } catch (err) {
      throw new TrackingUnavailableError('upstream', `DHL request failed: ${(err as Error).message}`);
    }

    if (res.status === 404) {
      return unknownInfo(awb, 'dhl', 'DHL has no record of this AWB yet', now);
    }
    if (res.status === 401 || res.status === 403) {
      throw new TrackingUnavailableError('auth', 'DHL authentication failed');
    }
    if (res.status === 429) {
      throw new TrackingUnavailableError('rate_limited', 'DHL rate limit hit');
    }
    if (res.status >= 500) {
      throw new TrackingUnavailableError('upstream', `DHL upstream error ${res.status}`);
    }
    if (!res.ok) {
      throw new TrackingUnavailableError('upstream', `DHL unexpected response ${res.status}`);
    }

    const body = (await res.json()) as DhlResponse;
    const shipment = body.shipments?.[0];
    const status = shipment?.status;
    const checked_at = now.toISOString();
    if (!shipment || !status) {
      return unknownInfo(awb, 'dhl', 'DHL has no record of this AWB yet', now);
    }

    const description = status.description ?? undefined;
    const remark = status.remark ?? undefined;
    const eventDescription = shipment.events?.[0]?.description ?? undefined;
    const last_event = description ?? remark ?? eventDescription ?? null;
    // Classification looks at every free-text field DHL might carry the signal in — a hold
    // reported only on the first event (not on status.description/remark) must still be caught.
    const combined = `${description ?? ''} ${remark ?? ''} ${eventDescription ?? ''}`;

    let mapped: TrackingInfo['status'] = STATUS_CODE_MAP[status.statusCode ?? ''] ?? 'unknown';
    if (mapped === 'in_transit' && /out for delivery/i.test(combined)) {
      mapped = 'out_for_delivery';
    } else if (mapped === 'in_transit' && HOLD_SIGNAL.test(combined) && !HOLD_RESOLVED.test(combined)) {
      mapped = 'exception';
    }

    const exception_reason: ExceptionReason | null = mapped === 'exception' ? (reasonFromText(combined) ?? 'other') : null;
    const location = status.location?.address?.addressLocality ?? null;
    const eta = shipment.estimatedTimeOfDelivery ?? null;
    const delivered_at = mapped === 'delivered' ? status.timestamp ?? null : null;

    return {
      awb,
      courier: 'dhl',
      status: mapped,
      exception_reason,
      last_event,
      last_event_at: status.timestamp ?? null,
      location,
      eta,
      delivered_at,
      note: last_event ?? `DHL status: ${mapped}`,
      source: 'dhl',
      checked_at,
    };
  }
}
