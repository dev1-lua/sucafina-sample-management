import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { actorFrom } from '../auth.js';
import { runWithEvent } from '../lib/mutate.js';

export const notifications = Router();

// Outbound client-email queue (migration 010). The agent's jobs poll these two GETs,
// send via the Lua email channel, then POST /mark so a row is never emailed twice.
// Candidates require a linked client whose contact book has an email — rows without
// one simply never surface here (the intake flow now asks for a client email).

const TABLE: Record<string, string> = {
  specialty: 'specialty_samples',
  bulk: 'bulk_samples',
  forwarding: 'forwarding_samples',
};

// First contact with a usable email, oldest first (the primary contact by convention).
const CONTACT_EMAIL = `
  JOIN clients c ON c.id = t.client_id AND c.deleted_at IS NULL
  JOIN LATERAL (
    SELECT email FROM client_contacts
     WHERE client_id = c.id AND email IS NOT NULL AND email <> ''
     ORDER BY created_at LIMIT 1
  ) ct ON true`;

// Samples dispatched (dispatched_on stamped — historical rows stay NULL and are never
// emailed) whose client hasn't been told yet. Status list covers rows that moved on
// past 'dispatched' between job runs.
notifications.get('/dispatch-pending', h(async (_req, res) => {
  const arm = (tab: string, table: string, ref: string, title: string, receiver: string) => `
    SELECT '${tab}'::text AS tab, t.id, t.${ref} AS ref, t.${title} AS title,
           t.${receiver} AS receiver, t.courier_norm, t.awb, t.qty_grams, t.dispatched_on,
           c.name AS client_name, ct.email
      FROM ${table} t${CONTACT_EMAIL}
     WHERE t.deleted_at IS NULL
       AND t.status IN ('dispatched','delivered','results_in')
       AND t.dispatched_on IS NOT NULL
       AND t.dispatch_notified_at IS NULL`;
  const { rows } = await pool.query(`
    ${arm('specialty', 'specialty_samples', 'ref', 'description', 'receiver_company')}
    UNION ALL
    ${arm('bulk', 'bulk_samples', 'sample_ref', 'quality', 'client')}
    UNION ALL
    ${arm('forwarding', 'forwarding_samples', 'sample_ref', 'coffee_quality', 'receiver_company')}
    ORDER BY dispatched_on, ref
    LIMIT 100`);
  res.json({ count: rows.length, items: rows });
}));

// Delivered ≥7 days with no verdict and no recorded feedback — chased once, ever.
// 30-day lower bound keeps the first run (and any long outage) from blasting the backlog.
// Forwarding is excluded: it has no delivery/feedback lifecycle.
notifications.get('/feedback-due', h(async (_req, res) => {
  const arm = (tab: string, table: string, ref: string, title: string) => `
    SELECT '${tab}'::text AS tab, t.id, t.${ref} AS ref, t.${title} AS title,
           t.delivery_on, c.name AS client_name, ct.email
      FROM ${table} t${CONTACT_EMAIL}
     WHERE t.deleted_at IS NULL
       AND t.status = 'delivered'
       AND t.delivery_on <= CURRENT_DATE - interval '7 days'
       AND t.delivery_on >= CURRENT_DATE - interval '30 days'
       AND t.result_norm IS NULL
       AND COALESCE(t.feedback_received, '') = ''
       AND t.feedback_chased_at IS NULL`;
  const { rows } = await pool.query(`
    ${arm('specialty', 'specialty_samples', 'ref', 'description')}
    UNION ALL
    ${arm('bulk', 'bulk_samples', 'sample_ref', 'quality')}
    ORDER BY delivery_on, ref
    LIMIT 100`);
  res.json({ count: rows.length, items: rows });
}));

const markSchema = z.object({
  tab: z.enum(['specialty', 'bulk', 'forwarding']),
  id: z.string().uuid(),
  kind: z.enum(['dispatch', 'feedback']),
  // Recorded in the audit note so the timeline shows where the email went.
  email: z.string().nullish(),
});

notifications.post('/mark', h(async (req, res) => {
  const body = parseBody(markSchema, req.body);
  if (body.kind === 'feedback' && body.tab === 'forwarding') {
    throw new HttpError(400, 'forwarding samples have no feedback chaser');
  }
  const actor = actorFrom(req);
  const column = body.kind === 'dispatch' ? 'dispatch_notified_at' : 'feedback_chased_at';
  const note = body.kind === 'dispatch'
    ? `dispatch confirmation emailed${body.email ? ` to ${body.email}` : ''}`
    : `7-day feedback chaser emailed${body.email ? ` to ${body.email}` : ''}`;
  const row = await runWithEvent(
    `UPDATE ${TABLE[body.tab]} SET ${column} = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [body.id],
    { entityType: body.tab, type: 'email_sent', note, actor },
  );
  if (!row) throw new HttpError(404, `${body.tab} sample not found`);
  res.json({ ok: true, id: body.id, kind: body.kind });
}));
