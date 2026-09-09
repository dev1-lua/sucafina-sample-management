import type { pool as Pool } from '../db.js';

// RC7 (2026-09-09): the intake "keep in the loop" question was being answered with the CLIENT's own
// contact email, so customers (Nestlé, Itochu) landed on the internal roster as "traders" and account
// managers — and received internal status pings. This module finds and fixes that, and is safe to
// re-run: once fixed, nothing matches.

/** Email domains that count as Sucafina-internal. Mirror of INTERNAL_EMAIL_DOMAINS in the agent. */
export const INTERNAL_EMAIL_DOMAINS = ['sucafina.com'];

export function isInternalEmail(email: string | null | undefined): boolean {
  const e = (email ?? '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 0) return false;
  const domain = e.slice(at + 1);
  return INTERNAL_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export type RosterExternal = {
  id: string;
  name: string;
  email: string;
  role: string;
  clients: { id: string; name: string }[];
};

type Db = Pick<typeof Pool, 'query'>;

/** Active roster rows whose email is outside the internal domains, with the clients they "manage". */
export async function findRosterExternals(db: Db): Promise<RosterExternal[]> {
  const { rows } = await db.query(
    `SELECT t.id, t.name, t.email, t.role,
            COALESCE((SELECT json_agg(json_build_object('id', c.id, 'name', c.name) ORDER BY c.name)
                        FROM clients c WHERE c.account_owner_id = t.id AND c.deleted_at IS NULL), '[]'::json) AS clients
       FROM traders t
      WHERE t.active AND t.email IS NOT NULL AND t.email <> ''
      ORDER BY t.name`,
  );
  return rows.filter((r: RosterExternal) => !isInternalEmail(r.email)) as RosterExternal[];
}

export type FixReport = {
  applied: boolean;
  found: RosterExternal[];
  unassigned: number;
  deactivated: number;
  contacts_added: number;
};

/**
 * For every external person on the roster: unassign them as account manager (their pings stop),
 * keep their email on the client as a CONTACT (that is where a customer's email belongs — dispatch
 * confirmations use it), deactivate the roster row (history intact, no longer selectable), and leave
 * a timeline entry on each client. Dry run by default.
 */
export async function fixRosterExternals(db: Db, o: { apply: boolean; actor: string }): Promise<FixReport> {
  const found = await findRosterExternals(db);
  const report: FixReport = { applied: o.apply, found, unassigned: 0, deactivated: 0, contacts_added: 0 };
  if (!o.apply) return report;
  for (const t of found) {
    for (const c of t.clients) {
      await db.query(`UPDATE clients SET account_owner_id = NULL, updated_at = now() WHERE id = $1`, [c.id]);
      report.unassigned += 1;
      const has = await db.query(`SELECT 1 FROM client_contacts WHERE client_id = $1 AND lower(email) = lower($2)`, [c.id, t.email]);
      if (!has.rows[0]) {
        await db.query(
          `INSERT INTO client_contacts (client_id, attention_to, email) VALUES ($1, $2, $3)`,
          [c.id, t.name, t.email],
        );
        report.contacts_added += 1;
      }
      await db.query(
        `INSERT INTO events (entity_type, entity_id, type, note, actor) VALUES ('client', $1, 'edited', $2, $3)`,
        [c.id, `account manager cleared: ${t.name} <${t.email}> is a client contact, not a Sucafina colleague — email kept on the client`, o.actor],
      );
    }
    await db.query(`UPDATE traders SET active = false WHERE id = $1`, [t.id]);
    report.deactivated += 1;
  }
  return report;
}
