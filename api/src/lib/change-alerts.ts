import type { PoolClient } from 'pg';
import { enqueueOutbox, type OutboxTab } from './notify-outbox.js';
import { isQcActor } from './actor.js';

// Change alerts to the Quality team (migration 017 — Harriet, round 6). Two triggers:
//   • a soft-delete of a sample / client / consignment, by ANYONE (rare, high-stakes: the lab may be
//     pulling a sample that no longer exists);
//   • an edit to a sample's REQUEST DEFINITION by a non-QC actor — the fields below, plus a
//     cancellation. Dispatch / AWB / delivery / result / stock / location / comments are QC's own work
//     and stay silent.
// Both ride the outbox and are drained by the agent's status-notifier into ONE grouped QC message per tick.

type SampleTab = 'specialty' | 'bulk' | 'forwarding';

export const REQUEST_FIELDS: Record<SampleTab, readonly string[]> = {
  // outturn / stocklot / name say WHICH lot the lab pulls — editable since migration 022, so a change is news.
  specialty: ['description', 'grade', 'qty_grams', 'client_id', 'receiver_company', 'country', 'priority',
              'shipment_month', 'contract_number', 'blend', 'phyto_cert', 'sample_type_norm',
              'outturn', 'stocklot', 'name'],
  bulk:      ['quality', 'qty_grams', 'client_id', 'country', 'priority',
              'shipment_month', 'contract_number', 'blend', 'phyto_cert', 'sample_type_norm'],
  forwarding: ['coffee_quality', 'receiver_company', 'origin', 'id_number', 'qty_grams', 'client_id', 'priority'],
};

export type FieldChange = { from: unknown; to: unknown };

const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');

/** Which request-definition fields changed between the row before and after a PATCH. */
export function diffRequestFields(
  tab: SampleTab,
  prev: Record<string, unknown>,
  row: Record<string, unknown>,
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const f of REQUEST_FIELDS[tab]) {
    if (!same(prev[f], row[f])) changes[f] = { from: prev[f] ?? null, to: row[f] ?? null };
  }
  // A cancellation redefines the request; other status moves are the lab's own progress.
  if (row.status === 'cancelled' && prev.status !== 'cancelled') changes.status = { from: prev.status ?? null, to: 'cancelled' };
  return changes;
}

/** After a sample PATCH: queue `request_edited` (one row per edit) unless nothing changed or QC did it. */
export async function enqueueRequestEdited(
  client: PoolClient,
  tab: SampleTab,
  prev: Record<string, unknown>,
  row: Record<string, unknown>,
  actor: string,
): Promise<boolean> {
  const changes = diffRequestFields(tab, prev, row);
  if (!Object.keys(changes).length) return false;
  if (await isQcActor(actor)) return false;
  await enqueueOutbox(client, {
    tab, sampleId: String(row.id), event: 'request_edited', recipient: 'qc',
    dedupeKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    payload: { changes }, actor,
  });
  return true;
}

/**
 * After a soft-delete: queue `deleted` for QC and close that entity's other pending rows — a
 * "preparing" ping for a sample that no longer exists must not go out (today it silently vanished
 * because outbox-pending joins the live row; now it is closed with a reason on the row).
 */
export async function enqueueDeleted(
  client: PoolClient,
  tab: OutboxTab,
  entityId: string,
  actor: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `UPDATE notifications_outbox
        SET sent_at = now(), attempts = attempts + 1, last_error = 'superseded: entity deleted'
      WHERE tab = $1 AND sample_id = $2 AND sent_at IS NULL AND event <> 'deleted'`,
    [tab, entityId],
  );
  await enqueueOutbox(client, { tab, sampleId: entityId, event: 'deleted', recipient: 'qc', payload: payload ?? null, actor });
}
