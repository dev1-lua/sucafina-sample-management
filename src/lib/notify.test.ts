import { describe, it, expect } from 'vitest';
import { autoLoopIns, type TraderRow } from './notify';

const row = (id: string, name: string, email: string | null, role: 'trader' | 'qc' = 'trader'): TraderRow =>
  ({ id, name, email, role, active: true });

const ROSTER: TraderRow[] = [
  row('1', 'Ivo', 'ivo@sucafina.com'),
  row('2', 'Muki', 'muki@sucafina.com'),
  row('3', 'Brian Kamau', 'brian.k@sucafina.com'),
  row('4', 'Brian Otieno', null),
  row('5', 'Harriet Muthoni', 'harriet@sucafina.com', 'qc'),
  row('6', 'Omar', null),
];

describe('autoLoopIns — the Sales Trader and the logger are always in the loop', () => {
  it('matches an exact roster name', () => {
    const r = autoLoopIns(['Ivo'], ROSTER);
    expect(r.hits.map((t) => t.id)).toEqual(['1']);
    expect(r.unresolved).toEqual([]);
  });

  it('matches a full Teams name to a short roster name by a shared word', () => {
    const r = autoLoopIns(['Muki Kristiya Bongers'], ROSTER);
    expect(r.hits.map((t) => t.id)).toEqual(['2']);
  });

  it('drops an ambiguous name and reports who it could have been', () => {
    const r = autoLoopIns(['Brian'], ROSTER);
    expect(r.hits).toEqual([]);
    expect(r.unresolved).toEqual(['Brian (matches several: Brian Kamau, Brian Otieno)']);
  });

  it('reports a name that is not on the roster', () => {
    const r = autoLoopIns(['Tommie'], ROSTER);
    expect(r.hits).toEqual([]);
    expect(r.unresolved).toEqual(['Tommie (not on the roster)']);
  });

  it('lists a person once when they are both requester and logger', () => {
    const r = autoLoopIns(['Ivo', 'Ivo'], ROSTER);
    expect(r.hits.map((t) => t.id)).toEqual(['1']);
  });

  it('ignores empty names', () => {
    const r = autoLoopIns([null, undefined, '  '], ROSTER);
    expect(r).toEqual({ hits: [], unresolved: [] });
  });

  it('a Quality-team member who logged the sample is a loop-in too', () => {
    const r = autoLoopIns(['Harriet Muthoni'], ROSTER);
    expect(r.hits.map((t) => t.id)).toEqual(['5']);
  });

  it('keeps a matched person without an email (the job reports them as unreachable by name)', () => {
    const r = autoLoopIns(['Omar'], ROSTER);
    expect(r.hits.map((t) => t.name)).toEqual(['Omar']);
  });
});
