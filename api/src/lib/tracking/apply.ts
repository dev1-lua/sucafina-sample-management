import type { PoolClient } from 'pg';
import { pool } from '../../db.js';
import { runWithEvent } from '../mutate.js';
import { enqueueOutbox } from '../notify-outbox.js';
import type { TrackingInfo } from '../tracking.js';
import type { SampleTab, TrackedRow } from './rows.js';

export type ApplyOutcome = 'delivered' | 'exception' | 'changed' | 'unchanged' | 'unknown';

const TABLE: Record<SampleTab, string> = {
  specialty: 'specialty_samples',
  bulk: 'bulk_samples',
  forwarding: 'forwarding_samples',
};

/**
 * Persist one courier answer onto a sample row.
 *  - info.status === 'unknown' → stamp tracking_checked_at only, no event. Returns 'unknown'.
 *  - identical to what's already stored (status + last_event) → same stamp-only update, no event.
 *    Returns 'unchanged'.
 *  - otherwise: one `delivery_update` event via runWithEvent, plus (on the newly-delivered or
 *    exception paths) an outbox row. `results_in`/`cancelled` samples are never demoted back to
 *    'delivered' by a stale courier answer, but delivery_on still gets stamped. Forwarding has no
 *    delivery_on column and never gets a `delivered` outbox row (no delivery/feedback lifecycle).
 */
export async function applyTracking(tab: SampleTab, row: TrackedRow, info: TrackingInfo, actor: string): Promise<ApplyOutcome> {
  const table = TABLE[tab];

  if (info.status === 'unknown') {
    await pool.query(`UPDATE ${table} SET tracking_checked_at = now() WHERE id = $1 AND deleted_at IS NULL`, [row.id]);
    return 'unknown';
  }

  const unchanged = info.status === row.tracking_status && (info.last_event ?? null) === row.tracking_last_event;
  if (unchanged) {
    await pool.query(`UPDATE ${table} SET tracking_checked_at = now() WHERE id = $1 AND deleted_at IS NULL`, [row.id]);
    return 'unchanged';
  }

  const outcome: ApplyOutcome =
    info.status === 'delivered' && row.tracking_status !== 'delivered' ? 'delivered'
    : info.status === 'exception' ? 'exception'
    : 'changed';

  const courierLabel = (row.courier_norm ?? info.courier ?? 'courier').toUpperCase();
  const note = `${courierLabel}: ${info.status} — ${info.last_event ?? '—'} (${info.location ?? '—'})`;
  const deliveredDate = info.delivered_at ? info.delivered_at.slice(0, 10) : null;
  const exceptionReason = info.status === 'exception' ? info.exception_reason : null;

  const sql = tab === 'forwarding'
    ? `UPDATE ${table} SET
         tracking_status = $2,
         tracking_last_event = $3,
         tracking_last_event_at = $4,
         tracking_exception = $5,
         tracking_checked_at = now(),
         status = CASE WHEN $2 = 'delivered' AND status NOT IN ('results_in','cancelled') THEN 'delivered' ELSE status END,
         updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL RETURNING *`
    : `UPDATE ${table} SET
         tracking_status = $2,
         tracking_last_event = $3,
         tracking_last_event_at = $4,
         tracking_exception = $5,
         tracking_checked_at = now(),
         delivery_on = CASE WHEN $2 = 'delivered' THEN COALESCE(delivery_on, $6::date) ELSE delivery_on END,
         status = CASE WHEN $2 = 'delivered' AND status NOT IN ('results_in','cancelled') THEN 'delivered' ELSE status END,
         updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL RETURNING *`;

  const params = tab === 'forwarding'
    ? [row.id, info.status, info.last_event, info.last_event_at, exceptionReason]
    : [row.id, info.status, info.last_event, info.last_event_at, exceptionReason, deliveredDate];

  await runWithEvent(
    sql,
    params,
    { entityType: tab, type: 'delivery_update', note, actor },
    async (client: PoolClient) => {
      // Newly delivered (this call is what flipped it): loop-in ping, not QC. Forwarding has no
      // delivery/feedback lifecycle so it never gets one.
      if (outcome === 'delivered' && tab !== 'forwarding') {
        await enqueueOutbox(client, {
          tab, sampleId: row.id, event: 'delivered', recipient: null,
          payload: {
            courier: info.courier, awb: info.awb, delivered_at: info.delivered_at,
            last_event: info.last_event, location: info.location,
          },
          actor,
        });
      }
      // Exception: QC-targeted, deduped per reason so repeat sweeps that keep seeing the same
      // hold don't re-announce it (the outbox UNIQUE (tab, sample_id, event, dedupe_key) no-ops).
      if (outcome === 'exception') {
        await enqueueOutbox(client, {
          tab, sampleId: row.id, event: 'tracking_exception', recipient: 'qc',
          dedupeKey: info.exception_reason ?? 'other',
          payload: {
            courier: info.courier, awb: info.awb, reason: info.exception_reason,
            last_event: info.last_event, last_event_at: info.last_event_at, location: info.location,
          },
          actor,
        });
      }
    },
  );

  return outcome;
}
