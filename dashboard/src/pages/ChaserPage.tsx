import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Digest, DigestBucket } from '../types';

const TITLES: Record<string, string> = {
  not_dispatched: '⏰ Not yet dispatched (past due)',
  no_delivery_confirmation: '🚚 Dispatched, no delivery confirmation (>5 days)',
  awaiting_results: '📋 Delivered, awaiting results (>7 days)',
};

function Bucket({ name, b }: { name: string; b: DigestBucket }) {
  return (
    <div className="card">
      <h3>{TITLES[name]} — {b.count}</h3>
      <table>
        <thead><tr><th>Ref</th><th>Type</th><th>Quality</th><th>Receiver</th><th>Deadline</th><th>AWB</th></tr></thead>
        <tbody>
          {b.items.map((i) => (
            <tr key={String(i.id)}>
              <td><Link to={`/samples/${i.id}`}>{(i.ref ?? i.ref_raw ?? '—') as string}</Link></td>
              <td>{i.sample_type as string}</td>
              <td>{i.quality as string}</td>
              <td>{i.receiver as string}</td>
              <td>{(i.deadline as string | null)?.slice(0, 10) ?? ''}</td>
              <td>{(i.awb as string | null) ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {b.count > b.items.length && <p className="muted">showing {b.items.length} of {b.count}</p>}
    </div>
  );
}

export default function ChaserPage() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    api<Digest>('/chaser/digest').then(setDigest).catch(() => setDigest(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async () => {
    setRunning(true);
    await api('/chaser/run', { method: 'POST' });
    setRunning(false);
    load();
  };

  return (
    <>
      <h2>Chaser digest <button className="primary" onClick={run} disabled={running}>{running ? 'running…' : 'Run now'}</button></h2>
      {digest ? (
        <>
          <p className="muted">generated {digest.generated_at.slice(0, 16).replace('T', ' ')}</p>
          {Object.entries(digest.buckets).map(([name, b]) => <Bucket key={name} name={name} b={b} />)}
        </>
      ) : <p className="muted">No digest yet — hit "Run now" or wait for the weekday-morning job.</p>}
    </>
  );
}
