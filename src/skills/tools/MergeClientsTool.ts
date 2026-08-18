import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { dashboardUrl } from '../../lib/links';
import { findClientByName, getClient, isInternalOffice, type BookClient } from '../../lib/client-guard';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve an id-or-name to one book entry. Names go through find_client semantics: a single exact
 * (case-insensitive) match, or a single partial match, wins; anything else refuses and lists the
 * candidates so the model asks instead of guessing.
 */
async function resolve(ref: string, role: string): Promise<BookClient> {
  const v = ref.trim();
  if (UUID_RE.test(v)) return getClient(v);
  const { client, candidates } = await findClientByName(v);
  if (client) return client;
  if (candidates.length === 0) throw new Error(`No client named "${v}" in the book (${role}). Check the spelling with find_client — nothing was merged.`);
  const list = candidates.map((c) => `${c.name} (${c.id})`).join('; ');
  throw new Error(`"${v}" (${role}) is ambiguous — matches: ${list}. Ask which one they mean and retry with that id. Nothing was merged.`);
}

export default class MergeClientsTool implements LuaTool {
  name = 'merge_clients';
  description =
    'Merge duplicate client entries: the sources fold INTO the target — their samples (all books) and contacts move to the target (matching people are merged, not duplicated), the target\'s empty fields (country, specs, phyto default) are filled from the sources, and the sources are removed from the book. Irreversible: ONLY call after the trader has confirmed the plan (target, sources). Refuses ambiguous names (lists candidates), and refuses to merge an internal Sucafina/Kenyacof office with an external client. Returns the surviving client + what moved.';

  inputSchema = z.object({
    target: z.string().describe('The entry to KEEP — client id (preferred) or exact company name. Prefer the entry that already has a delivery address on file.'),
    sources: z.array(z.string()).min(1).max(20).describe('Entries to fold into the target and remove — client ids (preferred) or exact company names.'),
    new_name: z.string().optional().describe('Optional: rename the surviving entry (e.g. keep the address-bearing entry but call it "Paulig").'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const target = await resolve(input.target, 'target');
    const sources: BookClient[] = [];
    for (const s of input.sources) sources.push(await resolve(s, 'source'));

    const dupes = sources.filter((s) => s.id === target.id);
    if (dupes.length) throw new Error(`"${target.name}" is both the target and a source — nothing to merge. Pick a different target or drop it from sources.`);
    const targetInternal = isInternalOffice(target.name);
    const cross = sources.find((s) => isInternalOffice(s.name) !== targetInternal);
    if (cross) {
      throw new Error(`Refusing: "${cross.name}" and "${target.name}" are not the same kind of entry (one is an internal Sucafina/Kenyacof office, the other an external client). Internal offices are never merged into clients. Nothing was merged.`);
    }

    const res = await apiFetch(`/clients/${encodeURIComponent(target.id)}/merge`, {
      method: 'POST',
      body: JSON.stringify({
        source_ids: [...new Set(sources.map((s) => s.id))],
        ...(input.new_name?.trim() ? { name: input.new_name.trim() } : {}),
      }),
    });

    const full = await getClient(target.id);
    const moved = res.repointed ?? { specialty: 0, bulk: 0, forwarding: 0, legacy: 0 };
    return {
      tab: 'clients',
      id: res.target.id,
      name: res.target.name,
      country: res.target.country ?? null,
      merged: res.merged as Array<{ id: string; name: string }>,
      samples_moved: { specialty: moved.specialty, bulk: moved.bulk, forwarding: moved.forwarding, legacy: moved.legacy,
        total: moved.specialty + moved.bulk + moved.forwarding + moved.legacy },
      contacts_folded: res.contacts_folded ?? 0,
      contacts_now: full.contacts.length,
      delivery_address_on_file: full.contacts.some((c) => (c.full_address ?? '').trim().length > 0),
      summary: `Merged ${(res.merged as any[]).map((m) => m.name).join(', ')} into ${res.target.name}: ${moved.specialty + moved.bulk + moved.forwarding + moved.legacy} sample rows and ${res.contacts_folded ?? 0} contacts moved; ${full.contacts.length} contacts now on file.`,
      url: dashboardUrl('clients', res.target.id, 'merged'),
    };
  }
}
