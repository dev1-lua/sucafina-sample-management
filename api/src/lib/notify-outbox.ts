import type { PoolClient } from 'pg';

export type OutboxEvent = 'created' | 'preparing' | 'dispatched' | 'awb_added';

/**
 * Queue a proactive notification (migration 013). Only ever called from a
 * runWithEvent extraWrites callback so the enqueue commits (or rolls back)
 * with the sample write itself. UNIQUE(tab, sample_id, event) makes repeat
 * transitions no-ops — a sample is never announced twice for the same event.
 */
export async function enqueueOutbox(
  client: PoolClient,
  o: { tab: 'specialty' | 'bulk' | 'forwarding'; sampleId: string; event: OutboxEvent; recipient: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO notifications_outbox (tab, sample_id, event, recipient)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tab, sample_id, event) DO NOTHING`,
    [o.tab, o.sampleId, o.event, o.recipient],
  );
}

/**
 * Shared PATCH-side enqueue for the three sample routers: pings the row's sales
 * trader (requested_by) on the transitions Ivo asked for. awb_added is suppressed
 * when the same call is the dispatch itself — that ping already carries the AWB.
 * Rows with no sales trader enqueue nothing (there is nobody to tell).
 */
export async function enqueueStatusEvents(
  client: PoolClient,
  tab: 'specialty' | 'bulk' | 'forwarding',
  row: Record<string, unknown>,
  prev: Record<string, unknown>,
  patch: { awb?: string | null; requested_by?: string | null },
  nextStatus: string | null,
): Promise<void> {
  const trader = (patch.requested_by ?? prev.requested_by) as string | null;
  if (!trader) return;
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
