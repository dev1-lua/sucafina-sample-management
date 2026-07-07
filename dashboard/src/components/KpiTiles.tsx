import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Stats } from '../types';

export default function KpiTiles({ refreshKey = 0 }: { refreshKey?: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => { api<Stats>('/stats').then(setStats).catch(console.error); }, [refreshKey]);
  if (!stats) return null;
  const tiles = [
    { label: 'Pending', num: (stats.by_status.requested ?? 0) + (stats.by_status.preparing ?? 0) },
    { label: 'In transit', num: stats.in_transit },
    { label: 'Awaiting results', num: stats.awaiting_results },
    { label: 'Overdue', num: stats.overdue },
    { label: 'Dispatched this week', num: stats.dispatched_this_week },
  ];
  return (
    <div className="tiles">
      {tiles.map((t) => (
        <div className="tile" key={t.label}>
          <div className="num">{t.num}</div>
          <div className="label">{t.label}</div>
        </div>
      ))}
    </div>
  );
}
