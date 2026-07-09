import { pool } from '../db.js';

// A self-contained source over the three base tables. Unlike all_samples_v it also projects the
// free-form follow-up fields (feedback_received, order_placed), which the reminders key off.
// Forwarding has no delivery_on column, so it is projected NULL — which also keeps it out of R3.
const SRC = `(
  SELECT 'specialty' AS tab, id, ref, description AS title, receiver_company AS receiver, awb,
         courier_norm, status, created_at, delivery_on, feedback_received, order_placed, deleted_at
    FROM specialty_samples
  UNION ALL
  SELECT 'bulk', id, sample_ref, quality, client, awb,
         courier_norm, status, created_at, delivery_on, feedback_received, order_placed, deleted_at
    FROM bulk_samples
  UNION ALL
  SELECT 'forwarding', id, sample_ref, coffee_quality, receiver_company, awb,
         courier_norm, status, created_at, NULL::date, feedback_received, order_placed, deleted_at
    FROM forwarding_samples
) s`;

const SELECT = `tab, id, ref, title, receiver, awb, courier_norm, status, created_at, delivery_on`;

export type ReminderKind = 'courier-awb' | 'feedback' | 'order-placed';
export const REMINDER_KINDS: ReminderKind[] = ['courier-awb', 'feedback', 'order-placed'];

// "Not done yet" is expressed as NULL-or-empty because the follow-up fields are free-form text.
// Aging thresholds are "gentle": R1 >1 day, R2 >3 days, R3 fixed at 15 days after delivery.
// R1/R2 age off created_at (reliably set); R3 ages off delivery_on (set on the delivered transition).
const WHERE: Record<ReminderKind, string> = {
  'courier-awb': `
    status IN ('requested','preparing')
    AND (awb IS NULL OR awb = '')
    AND (courier_norm IS NULL OR courier_norm = '')
    AND created_at < now() - interval '1 day'`,
  feedback: `
    status IN ('dispatched','delivered')
    AND (feedback_received IS NULL OR feedback_received = '')
    AND created_at < now() - interval '3 days'
    AND tab <> 'forwarding'`,
  'order-placed': `
    status IN ('delivered','results_in')
    AND delivery_on IS NOT NULL
    AND delivery_on < CURRENT_DATE - interval '15 days'
    AND (order_placed IS NULL OR order_placed = '')
    AND tab <> 'forwarding'`,
};

export type ReminderResult = { kind: ReminderKind; count: number; items: Record<string, unknown>[] };

export async function reminderBucket(kind: ReminderKind): Promise<ReminderResult> {
  const base = `FROM ${SRC} WHERE deleted_at IS NULL AND (${WHERE[kind]})`;
  const count = await pool.query(`SELECT count(*)::int AS n ${base}`);
  const items = await pool.query(`SELECT ${SELECT} ${base} ORDER BY created_at ASC LIMIT 50`);
  return { kind, count: count.rows[0].n, items: items.rows };
}
