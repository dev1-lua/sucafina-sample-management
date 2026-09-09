import {
  TrackingUnavailableError,
  unknownInfo,
  type ExceptionReason,
  type TrackingInfo,
  type TrackingProvider,
} from '../tracking.js';
import { reasonFromText } from './reasons.js';

type FedexError = { code?: string; message?: string };
type FedexDateTime = { type?: string; dateTime?: string };
type FedexScanLocation = { city?: string; countryCode?: string };
type FedexScanEvent = {
  date?: string;
  eventType?: string;
  eventDescription?: string;
  exceptionDescription?: string;
  scanLocation?: FedexScanLocation;
};
type FedexLatestStatusDetail = { code?: string; description?: string };
type FedexTrackResult = {
  error?: FedexError;
  latestStatusDetail?: FedexLatestStatusDetail;
  dateAndTimes?: FedexDateTime[];
  scanEvents?: FedexScanEvent[];
  estimatedDeliveryTimeWindow?: { window?: { ends?: string } };
};
type FedexCompleteTrackResult = { trackResults?: FedexTrackResult[] };
type FedexTrackResponse = { output?: { completeTrackResults?: FedexCompleteTrackResult[] } };
type FedexTokenResponse = { access_token: string; expires_in: number };

const STATUS_CODE_MAP: Record<string, TrackingInfo['status']> = {
  DL: 'delivered',
  OD: 'out_for_delivery',
  IT: 'in_transit',
  PU: 'in_transit',
  DP: 'in_transit',
  AR: 'in_transit',
  IX: 'in_transit',
  IN: 'in_transit',
  OC: 'in_transit',
  DE: 'exception',
  SE: 'exception',
  CD: 'exception',
  HL: 'exception',
  RS: 'exception',
  CA: 'exception',
};

// Baseline reason per code, refined below by the same regex table DHL uses over the
// free-text description/exceptionDescription — the regex wins when it finds a specific match.
const CODE_REASON: Partial<Record<string, ExceptionReason>> = {
  CD: 'customs_hold',
  RS: 'returned',
};

// Module-level: one FedEx OAuth token is shared across every FedexProvider instance/call,
// refreshed lazily `expires_in − 60s` before it would actually expire.
let tokenCache: { token: string; expiresAt: number } | null = null;

export function resetFedexTokenCache(): void {
  tokenCache = null;
}

export class FedexProvider implements TrackingProvider {
  name = 'fedex' as const;
  private clientId: string;
  private clientSecret: string;
  private base: string;
  private fetchImpl: typeof fetch;

  constructor(o: { clientId: string; clientSecret: string; base?: string; fetchImpl?: typeof fetch }) {
    this.clientId = o.clientId;
    this.clientSecret = o.clientSecret;
    this.base = o.base ?? 'https://apis-sandbox.fedex.com';
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new TrackingUnavailableError('upstream', `FedEx token request failed: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new TrackingUnavailableError('auth', 'FedEx authentication failed');
    }
    if (res.status === 429) {
      throw new TrackingUnavailableError('rate_limited', 'FedEx rate limit hit');
    }
    if (!res.ok) {
      throw new TrackingUnavailableError('upstream', `FedEx token error ${res.status}`);
    }
    const json = (await res.json()) as FedexTokenResponse;
    tokenCache = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
    return json.access_token;
  }

  private async getToken(forceRefresh = false): Promise<string> {
    if (forceRefresh) tokenCache = null;
    if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
    return this.fetchToken();
  }

  private doTrack(awb: string, token: string): Promise<Response> {
    return this.fetchImpl(`${this.base}/track/v1/trackingnumbers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-locale': 'en_US',
      },
      body: JSON.stringify({
        includeDetailedScans: true,
        trackingInfo: [{ trackingNumberInfo: { trackingNumber: awb } }],
      }),
    });
  }

  async track(awb: string, _dispatchedAt: Date | null, now: Date = new Date()): Promise<TrackingInfo> {
    let token = await this.getToken();
    let res: Response;
    try {
      res = await this.doTrack(awb, token);
    } catch (err) {
      throw new TrackingUnavailableError('upstream', `FedEx request failed: ${(err as Error).message}`);
    }

    if (res.status === 401) {
      token = await this.getToken(true);
      try {
        res = await this.doTrack(awb, token);
      } catch (err) {
        throw new TrackingUnavailableError('upstream', `FedEx request failed: ${(err as Error).message}`);
      }
      if (res.status === 401) {
        throw new TrackingUnavailableError('auth', 'FedEx authentication failed');
      }
    }

    if (res.status === 429) {
      throw new TrackingUnavailableError('rate_limited', 'FedEx rate limit hit');
    }
    if (res.status >= 500) {
      throw new TrackingUnavailableError('upstream', `FedEx upstream error ${res.status}`);
    }
    if (!res.ok) {
      throw new TrackingUnavailableError('upstream', `FedEx unexpected response ${res.status}`);
    }

    const body = (await res.json()) as FedexTrackResponse;
    const result = body.output?.completeTrackResults?.[0]?.trackResults?.[0];
    const checked_at = now.toISOString();
    if (!result || (result.error?.code && /NOTFOUND/.test(result.error.code))) {
      return unknownInfo(awb, 'fedex', 'FedEx has no record of this AWB yet', now);
    }

    const code = result.latestStatusDetail?.code ?? '';
    const status: TrackingInfo['status'] = STATUS_CODE_MAP[code] ?? 'unknown';
    const description = result.latestStatusDetail?.description ?? null;
    const firstScan = result.scanEvents?.[0];
    const exceptionDescription = firstScan?.exceptionDescription;

    let exception_reason: ExceptionReason | null = null;
    if (status === 'exception') {
      const text = `${exceptionDescription ?? ''} ${description ?? ''}`;
      exception_reason = reasonFromText(text) ?? CODE_REASON[code] ?? 'other';
    }

    const location = firstScan?.scanLocation
      ? `${firstScan.scanLocation.city ?? ''}, ${firstScan.scanLocation.countryCode ?? ''}`
      : null;
    const delivered_at = result.dateAndTimes?.find((d) => d.type === 'ACTUAL_DELIVERY')?.dateTime ?? null;
    const eta =
      result.estimatedDeliveryTimeWindow?.window?.ends ??
      result.dateAndTimes?.find((d) => d.type === 'ESTIMATED_DELIVERY')?.dateTime ??
      null;

    return {
      awb,
      courier: 'fedex',
      status,
      exception_reason,
      last_event: description,
      last_event_at: firstScan?.date ?? null,
      location,
      eta,
      delivered_at,
      note: description ?? `FedEx status: ${status}`,
      source: 'fedex',
      checked_at,
    };
  }
}
