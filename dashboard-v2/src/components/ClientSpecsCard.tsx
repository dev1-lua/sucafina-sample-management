import * as React from 'react';

import { usePatchRecord } from '@/lib/query';
import { Button } from '@/components/ui/button';
import type { ClientDetail } from './client-types';

// Feedback ⑯ (Lynne): the client's spec sheet — a guide for what to send them. Editable inline;
// numeric fields (moisture ceiling, min score) parse to numbers or clear to null.
export function ClientSpecsCard({ client }: { client: ClientDetail }) {
  const patch = usePatchRecord('/clients');
  const [grades, setGrades] = React.useState(client.spec_grades ?? '');
  const [cup, setCup] = React.useState(client.spec_cup_profile ?? '');
  const [moisture, setMoisture] = React.useState(client.spec_moisture_max?.toString() ?? '');
  const [score, setScore] = React.useState(client.spec_min_score?.toString() ?? '');
  const [notes, setNotes] = React.useState(client.spec_notes ?? '');
  const [saved, setSaved] = React.useState(false);

  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const dirty =
    grades !== (client.spec_grades ?? '') ||
    cup !== (client.spec_cup_profile ?? '') ||
    moisture !== (client.spec_moisture_max?.toString() ?? '') ||
    score !== (client.spec_min_score?.toString() ?? '') ||
    notes !== (client.spec_notes ?? '');

  function save() {
    setSaved(false);
    patch.mutate(
      {
        id: client.id,
        body: {
          spec_grades: grades.trim() || null,
          spec_cup_profile: cup.trim() || null,
          spec_moisture_max: num(moisture),
          spec_min_score: num(score),
          spec_notes: notes.trim() || null,
        },
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  const input = 'h-8 w-full rounded-[4px] border border-border bg-background px-2.5 text-sm outline-none focus:border-primary';
  const label = 'text-xs font-medium text-muted-foreground';

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-foreground">Specs</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">What to send this client — a guide for sample prep.</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && !dirty && <span className="text-xs text-muted-foreground">Saved</span>}
          <Button size="sm" variant="outline" disabled={!dirty || patch.isPending} onClick={save}>Save</Button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={label}>Preferred grades</span>
          <input className={input} value={grades} onChange={(e) => setGrades(e.target.value)} placeholder="e.g. AA, AB (screen 17+)" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Target cup profile</span>
          <input className={input} value={cup} onChange={(e) => setCup(e.target.value)} placeholder="e.g. clean, citric, fruity" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Max moisture %</span>
          <input className={input} type="number" step="0.1" value={moisture} onChange={(e) => setMoisture(e.target.value)} placeholder="e.g. 11.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Min cup score</span>
          <input className={input} type="number" step="0.5" value={score} onChange={(e) => setScore(e.target.value)} placeholder="e.g. 84" />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={label}>Notes</span>
          <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else the desk should know" />
        </label>
      </div>
    </section>
  );
}
