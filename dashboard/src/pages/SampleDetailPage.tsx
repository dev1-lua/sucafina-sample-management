import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import type { Sample, SampleEvent } from '../types';
import StatusBadge from '../components/StatusBadge';

type Detail = Sample & { events: SampleEvent[] };

export default function SampleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Detail | null>(null);
  const [tracking, setTracking] = useState<{ status: string; eta: string | null; note: string } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api<Detail>(`/samples/${id}`).then((d) => {
      setS(d);
      if (d.awb) api<{ status: string; eta: string | null; note: string }>(`/tracking/${d.awb}`).then(setTracking).catch(() => {});
    }).catch(console.error);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!s) return <p className="muted">loading…</p>;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(form)) if (v !== '') body[k] = k === 'qty_grams' ? Number(v) : v;
    await api(`/samples/${s.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    setForm({});
    setSaving(false);
    load();
  };

  return (
    <>
      <h2>{s.ref ?? s.ref_raw ?? 'sample'} <StatusBadge status={s.status} /></h2>
      <div className="card">
        <p><b>{s.quality}</b> · {s.sample_type} · {s.qty_grams ? `${s.qty_grams}g` : s.qty_raw ?? '?'} → {s.receiver}
          {s.requester ? <span className="muted"> (asked by {s.requester})</span> : null}</p>
        <p className="muted">requested {s.requested_at?.slice(0, 10) ?? '—'} · dispatched {s.dispatched_at?.slice(0, 10) ?? '—'} · delivered {s.delivered_at?.slice(0, 10) ?? '—'}</p>
        {s.awb && <p>AWB <b>{s.awb}</b> ({s.courier}) {tracking && <> — {tracking.status}{tracking.eta ? `, ETA ${tracking.eta.slice(0, 10)}` : ''} <span className="muted">({tracking.note})</span></>}</p>}
        {s.result && <p>Result: <b>{s.result}</b> {s.cupping_notes && <span className="muted">— {s.cupping_notes}</span>}</p>}
      </div>

      <div className="card">
        <h3>Edit</h3>
        <form className="grid" onSubmit={save}>
          <label>status
            <select value={form.status ?? ''} onChange={set('status')}>
              <option value="">(keep)</option>
              {['requested', 'preparing', 'dispatched', 'delivered', 'results_in', 'cancelled'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label>courier
            <select value={form.courier ?? ''} onChange={set('courier')}>
              <option value="">(keep)</option>
              {['dhl', 'fedex', 'ups', 'rider', 'hand_delivery', 'client_pickup', 'other'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label>awb <input value={form.awb ?? ''} onChange={set('awb')} placeholder={s.awb ?? ''} /></label>
          <label>quality <input value={form.quality ?? ''} onChange={set('quality')} placeholder={s.quality ?? ''} /></label>
          <label>qty (g) <input type="number" value={form.qty_grams ?? ''} onChange={set('qty_grams')} placeholder={String(s.qty_grams ?? '')} /></label>
          <label>deadline <input type="date" value={form.deadline ?? ''} onChange={set('deadline')} /></label>
          <label>result
            <select value={form.result ?? ''} onChange={set('result')}>
              <option value="">(keep)</option>
              {['approved', 'rejected', 'pending_feedback'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label>cupping notes <textarea value={form.cupping_notes ?? ''} onChange={set('cupping_notes')} placeholder={s.cupping_notes ?? ''} /></label>
          <label>comments <textarea value={form.comments ?? ''} onChange={set('comments')} placeholder={s.comments ?? ''} /></label>
          <button className="primary" disabled={saving || Object.keys(form).length === 0}>Save changes</button>
        </form>
      </div>

      <div className="card">
        <h3>Timeline</h3>
        <ul className="timeline">
          {s.events.map((e) => (
            <li key={e.id}>
              <b>{e.type.replace('_', ' ')}</b> — {e.note} <span className="muted">({e.actor}, {e.created_at.slice(0, 16).replace('T', ' ')})</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
