import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { ListResponse, Sample } from '../types';
import KpiTiles from '../components/KpiTiles';
import StatusBadge from '../components/StatusBadge';

const STATUSES = ['', 'requested', 'preparing', 'dispatched', 'delivered', 'results_in', 'cancelled'];
const TYPES = ['', 'offer', 'type', 'pss', 'woc', 'retention', 'flavor_mapping', 'marketing', 'calibration', 'other'];

export default function SamplesPage() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<ListResponse<Sample> | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    if (type) p.set('sample_type', type);
    api<ListResponse<Sample>>(`/samples?${p}`).then(setRes).catch(console.error);
  }, [q, status, type, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <h2>Samples</h2>
      <KpiTiles />
      <div className="filters">
        <input placeholder="Search ref / quality / receiver…" value={q}
               onChange={(e) => { setPage(1); setQ(e.target.value); }} />
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          {STATUSES.map((s) => <option key={s} value={s}>{s || 'any status'}</option>)}
        </select>
        <select value={type} onChange={(e) => { setPage(1); setType(e.target.value); }}>
          {TYPES.map((t) => <option key={t} value={t}>{t || 'any type'}</option>)}
        </select>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr><th>Ref</th><th>Type</th><th>Quality</th><th>Receiver</th><th>Status</th><th>Courier</th><th>AWB</th><th>Requested</th><th>Deadline</th></tr>
          </thead>
          <tbody>
            {res?.data.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => nav(`/samples/${s.id}`)}>
                <td>{s.ref ?? s.ref_raw ?? <span className="muted">—</span>}</td>
                <td>{s.sample_type}</td>
                <td>{s.quality}</td>
                <td>{s.receiver}</td>
                <td><StatusBadge status={s.status} /></td>
                <td>{s.courier ?? ''}</td>
                <td>{s.awb ?? ''}</td>
                <td>{s.requested_at?.slice(0, 10) ?? ''}</td>
                <td>{s.deadline?.slice(0, 10) ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          {res ? `${res.total} samples — page ${page}` : 'loading…'}
          {' '}
          <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>‹ prev</button>
          {' '}
          <button onClick={() => setPage(page + 1)} disabled={!res || page * 25 >= res.total}>next ›</button>
        </p>
      </div>
    </>
  );
}
