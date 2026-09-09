import { pool } from '../db.js';

// Who did it (Harriet, 2026-09-09: "changes to previous requests are to be communicated to the quality
// team"). Every write carries `x-actor`; the surface and the person's name are packed into one string:
//   dashboard:<Name> | dashboard | agent:<Full Name> | agent:chat | job:<job-name> | script:<name> | test
// The audit trail (events.actor) stores it verbatim; the change-alert filter parses it here.

export type Actor = { surface: string; name: string | null };

const NAMELESS = new Set(['chat', 'api', '']);

export function parseActor(actor: string | null | undefined): Actor {
  const raw = (actor ?? '').trim();
  const i = raw.indexOf(':');
  if (i < 0) return { surface: raw || 'api', name: null };
  const surface = raw.slice(0, i).trim() || 'api';
  const name = raw.slice(i + 1).trim();
  return { surface, name: NAMELESS.has(name.toLowerCase()) ? null : name };
}

const tokens = (s: string) => s.trim().toLowerCase().split(/\s+/).filter(Boolean);

let qcCache: { at: number; names: string[] } | null = null;
const QC_TTL_MS = 60_000;

async function qcNames(): Promise<string[]> {
  if (qcCache && Date.now() - qcCache.at < QC_TTL_MS) return qcCache.names;
  const { rows } = await pool.query(`SELECT name FROM traders WHERE active AND role = 'qc'`);
  qcCache = { at: Date.now(), names: rows.map((r: { name: string }) => String(r.name)) };
  return qcCache.names;
}

/** Drop the cache (tests, roster edits). */
export function resetQcCache() { qcCache = null; }

/**
 * Is this actor a member of the Quality team? Same matching rule as the agent's roster lookup
 * (exact name, else a shared whole word, case-insensitive). Unnamed actors are NOT QC — an unknown
 * editor is exactly who QC wants to hear about.
 */
export async function isQcActor(actor: string | null | undefined): Promise<boolean> {
  const { name } = parseActor(actor);
  if (!name) return false;
  const want = name.trim().toLowerCase();
  const wantToks = tokens(name);
  const names = await qcNames();
  return names.some((n) => n.trim().toLowerCase() === want || tokens(n).some((t) => wantToks.includes(t)));
}
