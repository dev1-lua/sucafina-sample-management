import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

async function makeClient(name: string, email?: string) {
  const res = await auth(request(app).post('/clients'))
    .send({ name, country: 'Kenya', ...(email ? { contact: { attention_to: 'QC', email } } : {}) });
  return res.body.id as string;
}

describe('GET /notifications/dispatch-pending', () => {
  let withEmail: string;
  let noEmail: string;

  beforeAll(async () => {
    withEmail = await makeClient('Emailed Coffee Co', 'qc@emailed.example');
    noEmail = await makeClient('Silent Coffee Co');
  });

  it('lists dispatched samples whose client has an email and no notification yet', async () => {
    const s = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Nyeri AA disp', receiver_company: 'Emailed Coffee Co', client_id: withEmail, qty_grams: 300 });
    await auth(request(app).patch(`/specialty-samples/${s.body.id}`))
      .send({ status: 'dispatched', courier_norm: 'dhl', awb: '555000111' });

    const pending = await auth(request(app).get('/notifications/dispatch-pending'));
    const item = pending.body.items.find((i: { id: string }) => i.id === s.body.id);
    expect(item).toBeTruthy();
    expect(item.email).toBe('qc@emailed.example');
    expect(item.client_name).toBe('Emailed Coffee Co');
    expect(item.awb).toBe('555000111');
  });

  it('excludes rows with no client, a client without email, or an existing stamp', async () => {
    const orphan = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'No client disp', receiver_company: 'Walk-in' });
    await auth(request(app).patch(`/specialty-samples/${orphan.body.id}`)).send({ status: 'dispatched' });

    const silent = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Silent client disp', receiver_company: 'Silent Coffee Co', client_id: noEmail });
    await auth(request(app).patch(`/specialty-samples/${silent.body.id}`)).send({ status: 'dispatched' });

    const marked = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Already marked disp', receiver_company: 'Emailed Coffee Co', client_id: withEmail });
    await auth(request(app).patch(`/specialty-samples/${marked.body.id}`)).send({ status: 'dispatched' });
    await auth(request(app).post('/notifications/mark'))
      .send({ tab: 'specialty', id: marked.body.id, kind: 'dispatch', email: 'qc@emailed.example' });

    const pending = await auth(request(app).get('/notifications/dispatch-pending'));
    const ids = pending.body.items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(orphan.body.id);
    expect(ids).not.toContain(silent.body.id);
    expect(ids).not.toContain(marked.body.id);
  });

  it('excludes historical rows dispatched before migration 010 (NULL dispatched_on)', async () => {
    const s = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Historical disp', receiver_company: 'Emailed Coffee Co', client_id: withEmail });
    await auth(request(app).patch(`/specialty-samples/${s.body.id}`)).send({ status: 'dispatched' });
    await pool.query(`UPDATE specialty_samples SET dispatched_on = NULL WHERE id = $1`, [s.body.id]);

    const pending = await auth(request(app).get('/notifications/dispatch-pending'));
    expect(pending.body.items.map((i: { id: string }) => i.id)).not.toContain(s.body.id);
  });
});

describe('GET /notifications/feedback-due', () => {
  let clientId: string;

  beforeAll(async () => {
    clientId = await makeClient('Feedback Coffee Co', 'cupping@feedback.example');
  });

  async function deliveredSample(desc: string, daysAgo: number) {
    const s = await auth(request(app).post('/bulk-samples'))
      .send({ quality: desc, client: 'Feedback Coffee Co', sample_type: 'offer', client_id: clientId });
    await auth(request(app).patch(`/bulk-samples/${s.body.id}`)).send({ status: 'delivered' });
    await pool.query(`UPDATE bulk_samples SET delivery_on = CURRENT_DATE - $2::int WHERE id = $1`, [s.body.id, daysAgo]);
    return s.body.id as string;
  }

  it('applies the 7-day and 30-day boundaries', async () => {
    const day6 = await deliveredSample('day6', 6);
    const day7 = await deliveredSample('day7', 7);
    const day31 = await deliveredSample('day31', 31);

    const due = await auth(request(app).get('/notifications/feedback-due'));
    const ids = due.body.items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(day6);
    expect(ids).toContain(day7);
    expect(ids).not.toContain(day31);
  });

  it('excludes rows with a verdict, recorded feedback, or a previous chase', async () => {
    const resulted = await deliveredSample('resulted', 10);
    await auth(request(app).patch(`/bulk-samples/${resulted}`)).send({ result_norm: 'approved' });

    const fedBack = await deliveredSample('fedback', 10);
    await auth(request(app).patch(`/bulk-samples/${fedBack}`)).send({ feedback_received: 'Yes' });

    const chased = await deliveredSample('chased', 10);
    await auth(request(app).post('/notifications/mark'))
      .send({ tab: 'bulk', id: chased, kind: 'feedback', email: 'cupping@feedback.example' });

    const due = await auth(request(app).get('/notifications/feedback-due'));
    const ids = due.body.items.map((i: { id: string }) => i.id);
    expect(ids).not.toContain(resulted);
    expect(ids).not.toContain(fedBack);
    expect(ids).not.toContain(chased);
  });
});

describe('POST /notifications/mark', () => {
  it('stamps the column and writes an email_sent event with the recipient', async () => {
    const clientId = await makeClient('Mark Coffee Co', 'desk@mark.example');
    const s = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Mark me', receiver_company: 'Mark Coffee Co', client_id: clientId });
    await auth(request(app).patch(`/specialty-samples/${s.body.id}`)).send({ status: 'dispatched' });

    const marked = await auth(request(app).post('/notifications/mark'))
      .send({ tab: 'specialty', id: s.body.id, kind: 'dispatch', email: 'desk@mark.example' });
    expect(marked.status).toBe(200);

    const detail = await auth(request(app).get(`/specialty-samples/${s.body.id}`));
    expect(detail.body.dispatch_notified_at).toBeTruthy();
    const ev = detail.body.events.find((e: { type: string }) => e.type === 'email_sent');
    expect(ev).toBeTruthy();
    expect(ev.note).toContain('desk@mark.example');
  });

  it('rejects a feedback mark on a forwarding sample and unknown ids', async () => {
    const bad = await auth(request(app).post('/notifications/mark'))
      .send({ tab: 'forwarding', id: '00000000-0000-0000-0000-000000000000', kind: 'feedback' });
    expect(bad.status).toBe(400);

    const missing = await auth(request(app).post('/notifications/mark'))
      .send({ tab: 'specialty', id: '00000000-0000-0000-0000-000000000000', kind: 'dispatch' });
    expect(missing.status).toBe(404);
  });
});

// Migration 013: proactive-notification outbox (feedback #29/#30).
describe('notifications outbox', () => {
  type OutboxItem = { outbox_id: string; sample_id: string; event: string; recipient: string | null };
  const itemsFor = async (sampleId: string) => {
    const pending = await auth(request(app).get('/notifications/outbox-pending'));
    return (pending.body.items as OutboxItem[]).filter((i) => i.sample_id === sampleId);
  };

  it('enqueues created→qc on create and carries logged_by / requested_by to the queue', async () => {
    const s = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Outbox create', receiver_company: 'OutboxCo', requested_by: 'Muki', logged_by: 'Harriet' });
    expect(s.body.logged_by).toBe('Harriet');

    const items = await itemsFor(s.body.id);
    expect(items).toHaveLength(1);
    expect(items[0].event).toBe('created');
    expect(items[0].recipient).toBe('qc');
    expect(items[0]).toMatchObject({ requested_by: 'Muki', logged_by: 'Harriet' });
  });

  it('enqueues preparing and dispatched transitions for the sales trader, deduping repeats', async () => {
    const s = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Outbox flow', receiver_company: 'OutboxCo', requested_by: 'Ivo' });

    await auth(request(app).patch(`/specialty-samples/${s.body.id}`)).send({ status: 'preparing' });
    await auth(request(app).patch(`/specialty-samples/${s.body.id}`)).send({ status: 'preparing' }); // repeat → deduped
    // Dispatch WITH the AWB in the same call: the dispatched ping carries it, so no separate awb_added.
    await auth(request(app).patch(`/specialty-samples/${s.body.id}`))
      .send({ status: 'dispatched', courier_norm: 'dhl', awb: '777000111' });

    const events = (await itemsFor(s.body.id)).map((i) => i.event).sort();
    expect(events).toEqual(['created', 'dispatched', 'preparing']);
    const trader = (await itemsFor(s.body.id)).find((i) => i.event === 'dispatched');
    expect(trader!.recipient).toBe('Ivo');
  });

  it('enqueues awb_added only when the AWB lands after the dispatch', async () => {
    const s = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Late AWB', receiver_company: 'OutboxCo', requested_by: 'Omar' });
    await auth(request(app).patch(`/specialty-samples/${s.body.id}`)).send({ status: 'dispatched' });
    await auth(request(app).patch(`/specialty-samples/${s.body.id}`)).send({ awb: '888000222' });

    const events = (await itemsFor(s.body.id)).map((i) => i.event).sort();
    expect(events).toEqual(['awb_added', 'created', 'dispatched']);
  });

  it('skips trader events when the row has no sales trader (created still fires)', async () => {
    const s = await auth(request(app).post('/bulk-samples'))
      .send({ quality: 'No trader lot', client: 'OutboxCo' });
    await auth(request(app).patch(`/bulk-samples/${s.body.id}`)).send({ status: 'preparing' });

    const events = (await itemsFor(s.body.id)).map((i) => i.event);
    expect(events).toEqual(['created']);
  });

  it('forwarding rows born dispatched enqueue created and dispatched together', async () => {
    const s = await auth(request(app).post('/forwarding-samples'))
      .send({ sender: 'Lab', origin: 'Kenya', sample_ref: 'FW-OB1', coffee_quality: 'AB',
              receiver_company: 'OutboxCo', awb: '999000333', courier_norm: 'dhl', requested_by: 'Gloria' });

    const events = (await itemsFor(s.body.id)).map((i) => i.event).sort();
    expect(events).toEqual(['created', 'dispatched']);
  });

  it('outbox-mark teams/email stamps sent_at and writes the matching timeline event', async () => {
    const s = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Mark outbox', receiver_company: 'OutboxCo', requested_by: 'Brian' });
    const [created] = await itemsFor(s.body.id);

    const marked = await auth(request(app).post('/notifications/outbox-mark'))
      .send({ id: created.outbox_id, via: 'teams', detail: 'Teams DM to Bernard, Harriet' });
    expect(marked.status).toBe(200);
    expect(await itemsFor(s.body.id)).toHaveLength(0); // no longer pending

    const detail = await auth(request(app).get(`/specialty-samples/${s.body.id}`));
    const ev = detail.body.events.find((e: { type: string }) => e.type === 'notified');
    expect(ev).toBeTruthy();
    expect(ev.note).toContain('Quality team notified');
    expect(ev.note).toContain('Bernard');

    // Second mark on the same row is a harmless no-op.
    const again = await auth(request(app).post('/notifications/outbox-mark'))
      .send({ id: created.outbox_id, via: 'teams' });
    expect(again.body.already).toBe(true);
  });

  it('outbox-mark skipped counts attempts and ages the row out at 5', async () => {
    const s = await auth(request(app).post('/specialty-samples'))
      .send({ description: 'Skip outbox', receiver_company: 'OutboxCo', requested_by: 'Nobody Known' });
    await auth(request(app).patch(`/specialty-samples/${s.body.id}`)).send({ status: 'preparing' });
    const prep = (await itemsFor(s.body.id)).find((i) => i.event === 'preparing')!;

    for (let n = 1; n <= 5; n++) {
      await auth(request(app).post('/notifications/outbox-mark'))
        .send({ id: prep.outbox_id, via: 'skipped', detail: 'no email on file' });
    }
    const left = (await itemsFor(s.body.id)).map((i) => i.event);
    expect(left).not.toContain('preparing'); // aged out
    const { rows } = await pool.query(`SELECT attempts, sent_at, last_error FROM notifications_outbox WHERE id = $1`, [prep.outbox_id]);
    expect(rows[0].attempts).toBe(5);
    expect(rows[0].sent_at).toBeTruthy();
    expect(rows[0].last_error).toBe('no email on file');
  });

  it('404s on an unknown outbox id', async () => {
    const missing = await auth(request(app).post('/notifications/outbox-mark'))
      .send({ id: '00000000-0000-0000-0000-000000000000', via: 'teams' });
    expect(missing.status).toBe(404);
  });
});
