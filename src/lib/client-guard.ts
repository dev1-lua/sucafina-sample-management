import { apiFetch } from './api';

// LOG FIRST, COMPLETE LATER (Beyers, 2026-09-08 — Ivo Jr.: "the goal is not for you to hard block me
// because you're missing an address… I just get the request and send it to you. Then you chase people
// down for the details you need.")
//
// History: the 2026-07-24 Folgers incident ("how do you plan to send the sample without the address?")
// turned the delivery address into an INTAKE blocker — the create tools refused to write a row until the
// client had a street address on file. That gate stalled every new-client request on the trader (Beyers,
// 14 minutes; Connect Coffee blocked on a phone; Sucafina Argentina abandoned). The address is a
// SHIPPING requirement, not a LOGGING one: the sample is written as soon as the coffee, type, qty and
// receiver are known; the gap is reported back to the model (client_details_missing) so it can route the
// ask (request_missing_details), recorded on the client, flagged on every read, and chased daily.

export type BookClient = {
  id: string;
  name: string;
  country: string | null;
  contacts: Array<{ attention_to: string | null; full_address: string | null; phone: string | null; email: string | null }>;
};

/** Internal Sucafina/Kenyacof offices (Geneva, NV, Germany, Yunnan, Argentina, HK…) — the desk knows where they are. */
export function isInternalOffice(name?: string | null): boolean {
  return /\b(sucafina|kenyacof)\b/i.test(name ?? '');
}

export function hasDeliveryAddress(client: Pick<BookClient, 'contacts'>): boolean {
  return (client.contacts ?? []).some((c) => (c.full_address ?? '').trim().length > 0);
}

export type ClientGaps = {
  /** Blocks DISPATCH, never logging: 'full street address' (+ 'country' when required and absent). */
  missing: string[];
  /** Ask once in chat, then move on: 'contact person', 'phone', 'email'. */
  optional: string[];
};

/** What the book still lacks for this client. Internal offices never have gaps. */
export function clientGaps(
  client: Pick<BookClient, 'name' | 'country' | 'contacts'>,
  opts: { requireCountry?: boolean; country?: string | null } = {},
): ClientGaps {
  if (isInternalOffice(client.name)) return { missing: [], optional: [] };
  const contacts = client.contacts ?? [];
  const has = (k: 'attention_to' | 'phone' | 'email') => contacts.some((c) => (c[k] ?? '').trim().length > 0);
  const missing: string[] = [];
  if (!hasDeliveryAddress(client)) missing.push('full street address');
  if (opts.requireCountry && !client.country && !(opts.country ?? '').trim()) missing.push('country');
  const optional: string[] = [];
  if (!has('attention_to')) optional.push('contact person');
  if (!has('phone')) optional.push('phone');
  if (!has('email')) optional.push('email');
  return { missing, optional };
}

/** Exact (case-insensitive) client lookup by name. Returns the single match, or the candidate list. */
export async function findClientByName(name: string): Promise<{ client: BookClient | null; candidates: BookClient[] }> {
  const q = name.trim();
  if (!q) return { client: null, candidates: [] };
  const res = await apiFetch(`/clients?q=${encodeURIComponent(q)}&pageSize=100`);
  const rows: any[] = res.data ?? [];
  const exact = rows.filter((c) => String(c.name).trim().toLowerCase() === q.toLowerCase());
  const pick = exact.length === 1 ? exact[0] : rows.length === 1 ? rows[0] : null;
  if (pick) return { client: await getClient(pick.id), candidates: [] };
  return { client: null, candidates: rows.map((c) => ({ id: c.id, name: c.name, country: c.country ?? null, contacts: [] })) };
}

export async function getClient(id: string): Promise<BookClient> {
  const c = await apiFetch(`/clients/${encodeURIComponent(id)}`);
  return {
    id: c.id,
    name: c.name,
    country: c.country ?? null,
    contacts: (c.contacts ?? []).map((ct: any) => ({
      attention_to: ct.attention_to ?? null,
      full_address: ct.full_address ?? null,
      phone: ct.phone ?? null,
      email: ct.email ?? null,
    })),
  };
}

export type DeliverableCheck = {
  /** Resolved client id to link the sample to (null only when nothing could be resolved or created). */
  client_id: string | null;
  client: BookClient | null;
  internal: boolean;
  /** True when the receiver was not in the book and a name-only shell was just added. */
  client_created: boolean;
  details_missing: string[];
  details_optional: string[];
};

/**
 * Resolve the receiver (by id, else exact name) and report the book's gaps WITHOUT blocking. An unknown
 * receiver is added to the book from its name so the sample, the loop-in contact, the recorded ask and
 * the daily chase all have something to attach to. The only throw left is ambiguity: several clients
 * match and guessing would link the sample to the wrong company.
 */
export async function checkDeliverable(opts: {
  client_id?: string | null;
  name?: string | null;
  /** Destination country already given on the create call (Commercial) — satisfies the country check. */
  country?: string | null;
  /** Require a country too (Commercial: destination country is needed for phyto + courier). */
  requireCountry?: boolean;
  /** Add a name-only shell when the receiver is not in the book (default true). */
  createIfMissing?: boolean;
}): Promise<DeliverableCheck> {
  const label = (opts.name ?? '').trim();
  let client: BookClient | null = null;
  let created = false;

  if (opts.client_id) {
    client = await getClient(opts.client_id);
  } else if (label) {
    const found = await findClientByName(label);
    if (found.client) client = found.client;
    else if (found.candidates.length > 1) {
      const list = found.candidates.map((c) => `${c.name} (${c.id})`).join('; ');
      throw new Error(
        `Several clients match "${label}" — ${list}. Do not create the sample yet: ask which one they mean, then retry with that client_id.`,
      );
    } else if (opts.createIfMissing !== false) {
      const shell = await apiFetch('/clients', {
        method: 'POST',
        body: JSON.stringify({ name: label, country: (opts.country ?? '').trim() || null }),
      });
      client = await getClient(shell.id);
      created = true;
    }
  }

  const internal = isInternalOffice(client?.name ?? label);
  if (!client) return { client_id: null, client: null, internal, client_created: false, details_missing: [], details_optional: [] };
  const gaps = clientGaps(client, { requireCountry: opts.requireCountry, country: opts.country });
  return { client_id: client.id, client, internal, client_created: created, details_missing: gaps.missing, details_optional: gaps.optional };
}
