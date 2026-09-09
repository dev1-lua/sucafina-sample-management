import type { PoolClient } from 'pg';

/**
 * Every event the outbox may carry (migration 013 + 017). Validated here, not by a DB CHECK.
 *   created / preparing / dispatched / awb_added — the original sample-status pings (013).
 *   deleted / request_edited — change alerts to the Quality team (017, Harriet round 6).
 *   delivered / tracking_exception — courier tracking (round 6, phase 4).
 *   pss_due_soon / pss_overdue / pss_rejected / pss_schedule_imported — contracts & PSS (phase 5).
 */
export const OUTBOX_EVENTS = [
  'created', 'preparing', 'dispatched', 'awb_added',
  'deleted', 'request_edited',
  'delivered', 'tracking_exception',
  'pss_due_soon', 'pss_overdue', 'pss_rejected', 'pss_schedule_imported',
] as const;
export type OutboxEvent = (typeof OUTBOX_EVENTS)[number];

export type OutboxTab = 'specialty' | 'bulk' | 'forwarding' | 'client' | 'consignment' | 'contract' | 'import';

/**
 * Queue a proactive notification. Only ever called from a runWithEvent extraWrites callback (or an
 * explicit transaction) so the enqueue commits — or rolls back — with the write itself.
 * UNIQUE (tab, sample_id, event, dedupe_key) makes repeats no-ops: with the default '' key an entity
 * is never announced twice for the same event; callers that want one row per occurrence pass a key.
 * Returns TRUE when a row was actually queued and FALSE when the dedupe swallowed it — the PSS sweep
 * reports how many people it woke, not how many contracts it looked at. Most callers ignore it.
 */
export async function enqueueOutbox(
  client: PoolClient,
  o: {
    tab: OutboxTab;
    sampleId: string;
    event: OutboxEvent;
    recipient: string | null;
    dedupeKey?: string;
    payload?: Record<string, unknown> | null;
    actor?: string | null;
  },
): Promise<boolean> {
  if (!OUTBOX_EVENTS.includes(o.event)) throw new Error(`unknown outbox event: ${o.event}`);
  const { rowCount } = await client.query(
    `INSERT INTO notifications_outbox (tab, sample_id, event, recipient, dedupe_key, payload, actor)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tab, sample_id, event, dedupe_key) DO NOTHING`,
    [o.tab, o.sampleId, o.event, o.recipient, o.dedupeKey ?? '', o.payload ? JSON.stringify(o.payload) : null, o.actor ?? null],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Shared PATCH-side enqueue for the three sample routers: queues the transitions Ivo
 * asked for. awb_added is suppressed when the same call is the dispatch itself — that
 * ping already carries the AWB. Since migration 014 the RECIPIENTS are resolved at send
 * time (client's account manager + the row's notify_trader_ids — see outbox-pending),
 * so every transition is queued; `recipient` keeps the requesting trader's name for the
 * audit note only.
 */
export async function enqueueStatusEvents(
  client: PoolClient,
  tab: 'specialty' | 'bulk' | 'forwarding',
  row: Record<string, unknown>,
  prev: Record<string, unknown>,
  patch: { awb?: string | null; requested_by?: string | null },
  nextStatus: string | null,
): Promise<void> {
  const trader = ((patch.requested_by ?? prev.requested_by) as string | null) ?? null;
  const sampleId = String(row.id);
  if (nextStatus === 'preparing' && prev.status !== 'preparing') {
    await enqueueOutbox(client, { tab, sampleId, event: 'preparing', recipient: trader });
  }
  if (nextStatus === 'dispatched' && prev.status !== 'dispatched') {
    await enqueueOutbox(client, { tab, sampleId, event: 'dispatched', recipient: trader });
  } else if (patch.awb && !prev.awb) {
    await enqueueOutbox(client, { tab, sampleId, event: 'awb_added', recipient: trader });
  }
}
