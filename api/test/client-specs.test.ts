import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { resetDb, API_KEY } from './helpers.js';

beforeAll(resetDb);
const auth = (r: request.Test) => r.set('x-api-key', API_KEY).set('x-actor', 'test');

describe('client specs (⑯)', () => {
  let clientId: string;

  it('stores spec fields via PATCH and reflects them on GET', async () => {
    const created = await auth(request(app).post('/clients')).send({ name: 'Paulig Specs Co', country: 'Finland' });
    expect(created.status).toBe(201);
    clientId = created.body.id;

    const patched = await auth(request(app).patch(`/clients/${clientId}`)).send({
      spec_grades: 'AA, AB FAQ, screen 17+',
      spec_cup_profile: 'Blackcurrant, bright acidity',
      spec_moisture_max: 11.5,
      spec_min_score: 84,
      spec_notes: 'No PB. Prefers Sept-Dec shipment.',
    });
    expect(patched.status).toBe(200);
    expect(patched.body.spec_grades).toBe('AA, AB FAQ, screen 17+');

    const detail = await auth(request(app).get(`/clients/${clientId}`));
    expect(detail.body.spec_cup_profile).toBe('Blackcurrant, bright acidity');
    expect(Number(detail.body.spec_moisture_max)).toBe(11.5);
    expect(Number(detail.body.spec_min_score)).toBe(84);
    expect(detail.body.spec_notes).toBe('No PB. Prefers Sept-Dec shipment.');
  });

  it('updates a single spec field without clobbering the others, and audits the edit', async () => {
    const patched = await auth(request(app).patch(`/clients/${clientId}`)).send({ spec_min_score: 85 });
    expect(Number(patched.body.spec_min_score)).toBe(85);
    expect(patched.body.spec_grades).toBe('AA, AB FAQ, screen 17+');

    const detail = await auth(request(app).get(`/clients/${clientId}`));
    const edit = detail.body.events.find((e: { type: string; note: string }) => e.type === 'edited' && e.note.includes('spec_min_score'));
    expect(edit).toBeTruthy();
  });
});

describe('feedback timing (⑭ result_on → stats.avg_feedback_days)', () => {
  it('auto-stamps result_on when a result is first recorded and feeds the stats average', async () => {
    const s = await auth(request(app).post('/bulk-samples')).send({ quality: 'AB FAQ', client: 'Paulig Specs Co', sample_type: 'pss' });
    expect(s.status).toBe(201);
    const id = s.body.id;

    // Deliver, then record a verdict — both stamp CURRENT_DATE, so turnaround is 0 days.
    const delivered = await auth(request(app).patch(`/bulk-samples/${id}`)).send({ status: 'delivered' });
    expect(delivered.body.delivery_on).toBeTruthy();
    const resulted = await auth(request(app).patch(`/bulk-samples/${id}`)).send({ result_norm: 'approved' });
    expect(resulted.body.result_on).toBeTruthy();

    const stats = await auth(request(app).get('/stats'));
    expect(stats.body.feedback_sample_count).toBe(1);
    expect(stats.body.avg_feedback_days).toBe(0);
  });

  it('keeps the original result_on on later edits', async () => {
    const s = await auth(request(app).post('/specialty-samples')).send({ description: 'Kirinyaga AA', receiver_company: 'Paulig Specs Co' });
    const id = s.body.id;
    const first = await auth(request(app).patch(`/specialty-samples/${id}`)).send({ result_norm: 'rejected' });
    const stamped = first.body.result_on;
    expect(stamped).toBeTruthy();
    const second = await auth(request(app).patch(`/specialty-samples/${id}`)).send({ result_norm: 'approved' });
    expect(second.body.result_on).toBe(stamped);
  });

  it('excludes samples without both dates from the average', async () => {
    // Result recorded but never delivered → contributes nothing to avg_feedback_days.
    const s = await auth(request(app).post('/bulk-samples')).send({ quality: 'AA PLUS', client: 'Paulig Specs Co', sample_type: 'offer' });
    await auth(request(app).patch(`/bulk-samples/${s.body.id}`)).send({ result_norm: 'approved' });
    const stats = await auth(request(app).get('/stats'));
    expect(stats.body.feedback_sample_count).toBe(1);
  });
});
