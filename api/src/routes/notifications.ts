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

// Proactive-notification outbox (migration 013, feedback #29/#30). Rows are enqueued
// in-transaction by the sample routers; the agent's status-notifier job polls this GET,
// DMs the Quality team ('created') or the row's sales trader (status events), then
// POSTs /outbox-mark. attempts < 5 keeps unresolvable recipients from clogging the
// queue forever — a skipped row ages out after 5 job passes.
notifications.get('/outbox-pending', h(async (_req, res) => {
  const arm = (tab: string, table: string, ref: string, title: string, receiver: string) => `
    SELECT o.id AS outbox_id, o.tab, o.sample_id, o.event, o.recipient, o.attempts,
           t.${ref} AS ref, t.${title} AS title, t.${receiver} AS receiver,
           t.status::text AS status, t.courier_norm, t.awb, t.qty_grams, t.priority,
           t.requested_by, t.logged_by, c.name AS client_name, o.created_at
      FROM notifications_outbox o
      JOIN ${table} t ON t.id = o.sample_id AND t.deleted_at IS NULL
      LEFT JOIN clients c ON c.id = t.client_id AND c.deleted_at IS NULL
     WHERE o.tab = '${tab}' AND o.sent_at IS NULL AND o.attempts < 5`;
  const { rows } = await pool.query(`
    ${arm('specialty', 'specialty_samples', 'ref', 'description', 'receiver_company')}
    UNION ALL
    ${arm('bulk', 'bulk_samples', 'sample_ref', 'quality', 'client')}
    UNION ALL
    ${arm('forwarding', 'forwarding_samples', 'sample_ref', 'coffee_quality', 'receiver_company')}
    ORDER BY created_at
    LIMIT 100`);
  res.json({ count: rows.length, items: rows });
}));

const outboxMarkSchema = z.object({
  id: z.string().uuid(),                          // notifications_outbox.id
  via: z.enum(['teams', 'email', 'skipped']),
  // Recorded in the audit note (delivered) or last_error (skipped): who got it / why not.
  detail: z.string().nullish(),
});

const OUTBOX_EVENT_NOTE: Record<string, string> = {
  created: 'Quality team notified of new request',
  preparing: 'sales trader notified: preparing',
  dispatched: 'sales trader notified: dispatched',
  awb_added: 'sales trader notified: AWB added',
};

notifications.post('/outbox-mark', h(async (req, res) => {
  const body = parseBody(outboxMarkSchema, req.body);
  const actor = actorFrom(req);
  const { rows } = await pool.query(`SELECT * FROM notifications_outbox WHERE id = $1`, [body.id]);
  const item = rows[0];
  if (!item) throw new HttpError(404, 'outbox row not found');
  if (item.sent_at) return res.json({ ok: true, id: body.id, already: true });

  if (body.via === 'skipped') {
    await pool.query(
      `UPDATE notifications_outbox
          SET attempts = attempts + 1, last_error = $2,
              sent_at = CASE WHEN attempts + 1 >= 5 THEN now() ELSE sent_at END
        WHERE id = $1`,
      [body.id, body.detail ?? null],
    );
    return res.json({ ok: true, id: body.id, skipped: true });
  }

  const note = `${OUTBOX_EVENT_NOTE[item.event] ?? item.event}${body.detail ? ` — ${body.detail}` : ''}`;
  const row = await runWithEvent(
    `UPDATE ${TABLE[item.tab]} SET updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [item.sample_id],
    // 'notified' = Teams DM (migration 013); 'email_sent' (migration 010) = email fallback.
    { entityType: item.tab, type: body.via === 'email' ? 'email_sent' : 'notified', note, actor },
    async (client) => {
      await client.query(
        `UPDATE notifications_outbox SET sent_at = now(), attempts = attempts + 1 WHERE id = $1`,
        [body.id],
      );
    },
  );
  if (!row) throw new HttpError(404, `${item.tab} sample not found`);
  res.json({ ok: true, id: body.id, event: item.event, via: body.via });
}));
