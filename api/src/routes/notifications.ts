import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { HttpError, parseBody, h } from '../errors.js';
import { actorFrom } from '../auth.js';
import { runWithEvent } from '../lib/mutate.js';
import { openSamplesFor } from '../lib/detail-requests.js';

export const notifications = Router();

// Outbound client-email queue (migration 010). The agent's jobs poll these two GETs,
// send via the Lua email channel, then POST /mark so a row is never emailed twice.
// Candidates require a linked client whose contact book has an email — rows without
// one simply never surface here (the intake flow now asks for a client email).

const TABLE: Record<string, string> = {
  specialty: 'specialty_samples',
  bulk: 'bulk_samples',
  forwarding: 'forwarding_samples',
  client: 'clients',
  consignment: 'consignments',
  contract: 'contracts',
  import: 'pss_imports',
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
// Non-sample entities (migration 017): a deleted client / consignment announces itself with the same
// column shape as the sample arms (NULL where a field has no meaning) so the job needs one item type.
const entityArm = (tab: string, table: string, ref: string) => `
    SELECT o.id AS outbox_id, o.tab, o.sample_id, o.event, o.recipient, o.attempts,
           o.dedupe_key, o.payload, o.actor,
           e.${ref} AS ref, NULL::text AS title, NULL::text AS receiver,
           NULL::text AS status, NULL::text AS courier_norm, NULL::text AS awb, NULL::int AS qty_grams, NULL::text AS priority,
           NULL::text AS requested_by, NULL::text AS logged_by, ${tab === 'client' ? 'e.name' : 'NULL::text'} AS client_name, o.created_at,
           false AS client_address_missing, NULL::text AS details_requested_from, NULL::timestamptz AS details_requested_at,
           NULL::text AS details_requested_via, NULL::text AS details_note,
           '[]'::json AS recipients
      FROM notifications_outbox o
      JOIN ${table} e ON e.id = o.sample_id
     WHERE o.tab = '${tab}' AND o.sent_at IS NULL AND o.attempts < 5`;

notifications.get('/outbox-pending', h(async (_req, res) => {
  const arm = (tab: string, table: string, ref: string, title: string, receiver: string) => `
    SELECT o.id AS outbox_id, o.tab, o.sample_id, o.event, o.recipient, o.attempts,
           o.dedupe_key, o.payload, o.actor,
           t.${ref} AS ref, t.${title} AS title, t.${receiver} AS receiver,
           t.status::text AS status, t.courier_norm, t.awb, t.qty_grams, t.priority,
           t.requested_by, t.logged_by, c.name AS client_name, o.created_at,
           -- Log-first (migration 016): QC's new-request ping must say the address is pending and who was asked.
           client_address_missing(t.client_id) AS client_address_missing,
           r.asked_name AS details_requested_from, r.asked_at AS details_requested_at,
           r.via AS details_requested_via, r.note AS details_note,
           -- Who is kept in the loop (migration 014): the client's account manager plus any
           -- people added on the sample itself. Resolved here, at send time, so a manager set
           -- after the event was queued still gets it. Email may be null → job marks skipped.
           COALESCE((
             SELECT json_agg(json_build_object('id', tr.id, 'name', tr.name, 'email', tr.email) ORDER BY tr.name)
               FROM traders tr
              WHERE tr.active AND (tr.id = c.account_owner_id OR tr.id = ANY (t.notify_trader_ids))
           ), '[]'::json) AS recipients
      FROM notifications_outbox o
      -- a deleted sample still surfaces for its own 'deleted' alert (migration 017)
      JOIN ${table} t ON t.id = o.sample_id AND (t.deleted_at IS NULL OR o.event = 'deleted')
      LEFT JOIN clients c ON c.id = t.client_id AND c.deleted_at IS NULL
      LEFT JOIN client_detail_requests r ON r.client_id = t.client_id AND r.resolved_at IS NULL
     WHERE o.tab = '${tab}' AND o.sent_at IS NULL AND o.attempts < 5`;
  const { rows } = await pool.query(`
    ${arm('specialty', 'specialty_samples', 'ref', 'description', 'receiver_company')}
    UNION ALL
    ${arm('bulk', 'bulk_samples', 'sample_ref', 'quality', 'client')}
    UNION ALL
    ${arm('forwarding', 'forwarding_samples', 'sample_ref', 'coffee_quality', 'receiver_company')}
    UNION ALL
    ${entityArm('client', 'clients', 'name')}
    UNION ALL
    ${entityArm('consignment', 'consignments', 'number')}
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
  deleted: 'Quality team notified of deletion',
  request_edited: 'Quality team notified of request change',
  created: 'Quality team notified of new request',
  preparing: 'people in the loop notified: preparing',
  dispatched: 'people in the loop notified: dispatched',
  awb_added: 'people in the loop notified: AWB added',
  delivered: 'people in the loop notified: delivered',
  tracking_exception: 'Quality team + account manager notified: courier exception',
  pss_due_soon: 'Quality team + account manager reminded: PSS due soon',
  pss_overdue: 'Quality team + account manager reminded: PSS overdue',
  pss_rejected: 'Quality team + account manager reminded: PSS rejected twice, contract flagged',
  pss_schedule_imported: 'Quality team notified: PSS schedule imported',
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
      WHERE id = $1 ${item.event === 'deleted' ? '' : 'AND deleted_at IS NULL'} RETURNING *`,
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
  if (!row) throw new HttpError(404, `${item.tab} row not found`);
  res.json({ ok: true, id: body.id, event: item.event, via: body.via });
}));

// ---------------------------------------------------------------------------------------------------
// Log first, complete later (migration 016): the daily chase for a client's missing delivery details.
// details-pending = open asks whose client STILL has no address and still has a sample waiting to go
// out, due when nothing was ever delivered or the last touch is >20h old. Never ages out: an address gap
// must not expire silently — it ends when the address lands or the client's samples are all gone.
// ---------------------------------------------------------------------------------------------------

notifications.get('/details-pending', h(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT r.*, c.name AS client_name,
           EXTRACT(day FROM now() - r.asked_at)::int AS days_open,
           (SELECT json_build_object('id', tr.id, 'name', tr.name, 'email', tr.email)
              FROM traders tr WHERE tr.id = c.account_owner_id AND tr.active) AS account_manager
      FROM client_detail_requests r
      JOIN clients c ON c.id = r.client_id AND c.deleted_at IS NULL
     WHERE r.resolved_at IS NULL
       AND client_address_missing(r.client_id)
       AND EXISTS (SELECT 1 FROM all_samples_v v
                    WHERE v.client_id = r.client_id AND v.deleted_at IS NULL AND v.status IN ('requested','preparing'))
       AND (COALESCE(r.last_chased_at, r.delivered_at) IS NULL
            OR COALESCE(r.last_chased_at, r.delivered_at) < now() - interval '20 hours')
     ORDER BY r.asked_at
     LIMIT 50`);
  const items = [];
  for (const r of rows) items.push({ ...r, samples: await openSamplesFor(pool, r.client_id) });
  res.json({ count: items.length, items });
}));

const detailsMarkSchema = z.object({
  id: z.string().uuid(),                          // client_detail_requests.id
  via: z.enum(['teams', 'email', 'skipped']),
  detail: z.string().nullish(),                   // who got it / why not — goes on the timeline
  escalated: z.boolean().nullish(),               // first escalation stamps escalated_at
});

notifications.post('/details-mark', h(async (req, res) => {
  const body = parseBody(detailsMarkSchema, req.body);
  const actor = actorFrom(req);
  const skipped = body.via === 'skipped';
  const { rows } = await pool.query(
    `UPDATE client_detail_requests SET
       chase_count    = chase_count + 1,
       last_chased_at = now(),
       delivered_at   = CASE WHEN $2::boolean THEN delivered_at ELSE COALESCE(delivered_at, now()) END,
       via            = CASE WHEN $2::boolean THEN via ELSE COALESCE(via, $3) END,
       escalated_at   = CASE WHEN $4::boolean THEN COALESCE(escalated_at, now()) ELSE escalated_at END
     WHERE id = $1 AND resolved_at IS NULL RETURNING *`,
    [body.id, skipped, skipped ? null : body.via, body.escalated === true],
  );
  const r = rows[0];
  if (!r) throw new HttpError(404, 'open detail request not found');
  const who = r.asked_name ?? r.asked_email ?? 'nobody named';
  const note = skipped
    ? `chase #${r.chase_count} skipped${body.detail ? ` — ${body.detail}` : ''}`
    : `chase #${r.chase_count} → ${who} (${body.via})${body.escalated ? ' · escalated' : ''}${body.detail ? ` — ${body.detail}` : ''}`;
  await pool.query(
    `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('client', $1, 'details_chased', $2, $3)`,
    [r.client_id, note, actor],
  );
  for (const s of await openSamplesFor(pool, r.client_id)) {
    await pool.query(
      `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ($1, $2, 'details_chased', $3, $4)`,
      [s.tab, s.id, note, actor],
    );
  }
  res.json({ ok: true, id: r.id, chase_count: r.chase_count, via: r.via, escalated_at: r.escalated_at });
}));
