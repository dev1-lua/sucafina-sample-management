import { Router } from 'express';
import { z } from 'zod';
import { parseBody, h } from '../errors.js';
import { actorFrom } from '../auth.js';
import { TrackingUnavailableError, unknownInfo, type TrackingInfo } from '../lib/tracking.js';
import { providerFor, guessCourier, notConfiguredNote } from '../lib/tracking/registry.js';
import { rowsByAwb, sweepPool, type TrackedRow } from '../lib/tracking/rows.js';
import { applyTracking } from '../lib/tracking/apply.js';

export const tracking = Router();

// The registry's own courier normalisation isn't exported (routes shouldn't reach past it), so
// this is a small local mirror: only used here to decide *which* provider to ask and to build the
// "not configured" / "no courier on record" note when there isn't one.
function normCourier(courierNorm: string | null | undefined): 'dhl' | 'fedex' | null {
  const c = (courierNorm ?? '').trim().toLowerCase();
  if (c === 'dhl') return 'dhl';
  if (c === 'fedex') return 'fedex';
  return null;
}

function dispatchedAtOf(r: TrackedRow | undefined): Date | null {
  if (!r) return null;
  return r.dispatched_on ? new Date(r.dispatched_on) : r.date_on ? new Date(r.date_on) : null;
}

const pick = (r: TrackedRow) => ({ tab: r.tab, id: r.id, ref: r.ref });

// Live lookup by AWB: finds every sample row (any tab) carrying this AWB, asks the courier's
// provider once, then persists the answer onto every DISPATCHED match (a delivered/results_in row
// keeps its own tracking snapshot rather than being re-stamped by a stale lookup).
tracking.get('/:awb', h(async (req, res) => {
  const awb = String(req.params.awb).trim();
  const actor = actorFrom(req);
  const rows = await rowsByAwb(awb);
  const courier = normCourier(rows[0]?.courier_norm) ?? guessCourier(awb);
  const provider = courier ? providerFor(courier) : null;
  if (!provider) {
    return res.json({
      ...unknownInfo(
        awb, courier,
        courier ? notConfiguredNote(courier) : 'no courier on record and the number does not look like a DHL or FedEx AWB',
      ),
      rows: rows.map(pick),
    });
  }
  let info: TrackingInfo;
  try {
    info = await provider.track(awb, dispatchedAtOf(rows[0]));
  } catch (e) {
    if (e instanceof TrackingUnavailableError) {
      return res.status(503).json({ error: e.message, reason: e.reason });
    }
    throw e;
  }
  for (const r of rows.filter((r) => r.status === 'dispatched')) {
    await applyTracking(r.tab, r, info, actor);
  }
  res.json({ ...info, rows: rows.map(pick) });
}));

const sweepSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  min_age_hours: z.number().min(0).optional(),
});

// Batch sweep: pulls the pool of dispatched dhl/fedex rows due for a re-check, groups by
// courier+AWB (several rows can share one AWB — e.g. a specialty + bulk sample dispatched
// together), and calls the provider once per group. A rate_limited/daily_cap error stops the
// sweep outright (that provider is done for now); any other error just counts against that group
// and the sweep continues — one bad AWB must never abort the whole batch.
tracking.post('/sweep', h(async (req, res) => {
  const { limit = 40, min_age_hours = 4 } = parseBody(sweepSchema, req.body ?? {});
  const actor = actorFrom(req);
  const { rows, remaining } = await sweepPool({ limit, minAgeHours: min_age_hours });

  const out = { checked: 0, delivered: 0, exceptions: 0, unchanged: 0, errors: 0, skipped_no_provider: 0, remaining };

  const byAwb = new Map<string, TrackedRow[]>();
  for (const r of rows) {
    const key = `${r.courier_norm}|${r.awb}`;
    byAwb.set(key, [...(byAwb.get(key) ?? []), r]);
  }

  for (const group of byAwb.values()) {
    const provider = providerFor(group[0].courier_norm);
    if (!provider) {
      out.skipped_no_provider += group.length;
      continue;
    }
    let info: TrackingInfo;
    try {
      info = await provider.track(group[0].awb, dispatchedAtOf(group[0]));
    } catch (e) {
      out.errors += group.length;
      console.error('[tracking/sweep]', group[0].awb, (e as Error).message);
      if (e instanceof TrackingUnavailableError && (e.reason === 'daily_cap' || e.reason === 'rate_limited')) break;
      continue;
    }
    for (const r of group) {
      const outcome = await applyTracking(r.tab, r, info, actor);
      out.checked += 1;
      if (outcome === 'delivered') out.delivered += 1;
      else if (outcome === 'exception') out.exceptions += 1;
      else if (outcome === 'unchanged' || outcome === 'unknown') out.unchanged += 1;
    }
  }

  res.json(out);
}));
