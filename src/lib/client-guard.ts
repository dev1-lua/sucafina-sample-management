import { apiFetch } from './api';

// Delivery-address guard for sample creation.
//
// Background (Teams, 2026-07-24): the agent logged TYPE-1006/1007 for Folgers after adding the
// client with only a name + phone — no address, no country. "How do you plan to send the sample
// without having the address?" Prompt guidance alone did not hold, so the create tools now refuse
// to write a row for an external receiver whose book entry has no delivery address. The error text
// is written for the model: it says exactly what to ask the trader and which tool to call next.

export type BookClient = {
  id: string;
  name: string;
  country: string | null;
  contacts: Array<{ attention_to: string | null; full_address: string | null; phone: string | null; email: string | null }>;
};

/** Internal Sucafina/Kenyacof offices (Geneva, NV, Germany, Yunnan, HK…) — the desk knows where they are. */
export function isInternalOffice(name?: string | null): boolean {
  return /\b(sucafina|kenyacof)\b/i.test(name ?? '');
}

export function hasDeliveryAddress(client: Pick<BookClient, 'contacts'>): boolean {
  return (client.contacts ?? []).some((c) => (c.full_address ?? '').trim().length > 0);
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
  /** Resolved client id to link the sample to (null only for an internal office not in the book). */
  client_id: string | null;
  client: BookClient | null;
  internal: boolean;
};

/**
 * Refuse to create a sample for an external receiver with no delivery address on file.
 * Resolves the client by id (preferred) or exact name; internal offices pass through.
 * Throws a model-facing error naming the next step (ask → upsert_client → retry).
 */
export async function assertDeliverable(opts: {
  client_id?: string | null;
  name?: string | null;
  /** Destination country already given on the create call (Commercial) — satisfies the country check. */
  country?: string | null;
  /** Require a country too (Commercial: destination country is needed for phyto + courier). */
  requireCountry?: boolean;
}): Promise<DeliverableCheck> {
  const label = (opts.name ?? '').trim();
  let client: BookClient | null = null;

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
    }
  }

  const internal = isInternalOffice(client?.name ?? label);
  if (internal) return { client_id: client?.id ?? null, client, internal: true };

  if (!client) {
    throw new Error(
      `"${label || 'this receiver'}" is not in the client book yet — do NOT create the sample. First ask for their contact person, full street address, country, phone and email, then call upsert_client { name, country, attention_to, full_address, phone, email } and pass the returned id as client_id when you retry.`,
    );
  }

  const missing: string[] = [];
  if (!hasDeliveryAddress(client)) missing.push('full street address');
  if (opts.requireCountry && !client.country && !(opts.country ?? '').trim()) missing.push('country');
  if (missing.length) {
    throw new Error(
      `${client.name} has no ${missing.join(' or ')} on file — do NOT create the sample yet. Ask the trader for the client's ${missing.join(' and ')}, save it with upsert_client { name: "${client.name}"${missing.includes('full street address') ? ', full_address' : ''}${missing.includes('country') ? ', country' : ''} }, then retry this call with client_id "${client.id}".`,
    );
  }

  return { client_id: client.id, client, internal: false };
}
