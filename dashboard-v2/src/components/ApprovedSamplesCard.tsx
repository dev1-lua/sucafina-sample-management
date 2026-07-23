import { useNavigate } from 'react-router-dom';

import type { ClientOrder, ClientOrderTab } from './client-types';

const TAB_PATH: Record<ClientOrderTab, string> = { specialty: '/samples', bulk: '/bulk', forwarding: '/forwarding' };

// Feedback ⑬ (Omar): the client's approved coffees with Strategy / Blend / Highlights, so a trader
// hunting for a specific cup profile can scan them. Sourced from the client's orders (result=approved).
export function ApprovedSamplesCard({ orders }: { orders: ClientOrder[] }) {
  const navigate = useNavigate();
  const approved = orders.filter((o) => o.result_norm === 'approved');

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium text-foreground">Approved samples</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Strategy · blend · cup-profile highlights.</p>
      {approved.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No approved samples yet.</p>
      ) : (
        <div className="mt-3 flex flex-col divide-y divide-border">
          {approved.map((o) => (
            <button
              key={`${o.tab}-${o.id}`}
              type="button"
              onClick={() => navigate(`${TAB_PATH[o.tab]}/${o.id}`)}
              className="flex flex-col gap-1 py-2 text-left hover:bg-muted/40"
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-foreground">{o.ref || '(no ref)'}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{o.title || '—'}</span>
                {o.result_on && <span className="shrink-0 text-xs text-muted-foreground">{String(o.result_on).slice(0, 10)}</span>}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                {o.strategy && <span><span className="font-medium">Strategy:</span> {o.strategy}</span>}
                {o.blend && <span><span className="font-medium">Blend:</span> {o.blend}</span>}
                {o.highlights && <span><span className="font-medium">Highlights:</span> {o.highlights}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
