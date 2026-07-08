import { useEffect, useState } from 'react';
import { IconMoon, IconSun } from '@tabler/icons-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/StatusBadge';
import { getTheme, setTheme, toggleTheme, type Theme } from '@/lib/theme';

const STATUSES = ['requested', 'preparing', 'dispatched', 'delivered', 'results_in', 'cancelled'];
const RESULTS = ['approved', 'rejected', 'pending_feedback'];
const SAMPLE_TYPES = ['offer', 'type', 'pss', 'woc', 'retention', 'flavor_mapping', 'marketing', 'calibration'];

export default function App() {
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    const initial = getTheme();
    setTheme(initial);
    setThemeState(initial);
  }, []);

  return (
    <div className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold">Sucafina Sample Desk — foundation booting.</h1>
            <p className="text-xs text-muted-foreground">Design-token pass — Task 2 of 7 (dashboard-v2)</p>
          </div>
          <Button variant="outline" size="icon" onClick={() => setThemeState(toggleTheme())} aria-label="Toggle theme">
            {theme === 'dark' ? <IconSun className="size-4" /> : <IconMoon className="size-4" />}
          </Button>
        </header>

        <section className="rounded-lg border border-border bg-card p-5 text-card-foreground">
          <h2 className="mb-3 text-sm font-medium">Status</h2>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <StatusBadge key={s} kind="status" value={s} />
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5 text-card-foreground">
          <h2 className="mb-3 text-sm font-medium">Result</h2>
          <div className="flex flex-wrap gap-2">
            {RESULTS.map((r) => (
              <StatusBadge key={r} kind="result" value={r} />
            ))}
            <StatusBadge kind="result" value={null} />
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5 text-card-foreground">
          <h2 className="mb-3 text-sm font-medium">Sample type</h2>
          <div className="flex flex-wrap gap-2">
            {SAMPLE_TYPES.map((t) => (
              <StatusBadge key={t} kind="sample_type" value={t} />
            ))}
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-5 text-card-foreground">
          <Button>Primary action</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Input placeholder="Search samples…" className="max-w-xs" />
        </section>
      </div>
    </div>
  );
}
