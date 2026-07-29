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
