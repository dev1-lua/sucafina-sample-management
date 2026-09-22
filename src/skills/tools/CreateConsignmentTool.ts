import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { consignmentUrl } from '../../lib/links';
import { currentUserName } from '../../lib/current-user';
import { normalizeLocation, TABS } from '../../lib/normalize';
import { resolveSamples } from './_consignment';

const member = z.object({
  tab: z.enum(TABS).describe("The sample's book key — 'specialty' | 'bulk' (Commercial) | 'forwarding' — from the create result."),
  id: z.string().describe('Sample row id from the create result.'),
});

export default class CreateConsignmentTool implements LuaTool {
  name = 'create_consignment';
  description =
    'Create an order — a consignment grouping the samples of ONE request to ONE client, numbered CN-#### by the desk (never invent one). Call it right after the creates when a request had two or more coffees for the same receiver: pass samples [{tab, id}] straight from the create results (or refs [] for existing rows), the client_id and requested_by / logged_by from the creates, so the order carries the people and the QC ping goes out as one message. Optional lab location (Westlands/Thika) and a note.';

  inputSchema = z.object({
    samples: z.array(member).optional().describe('The sends to group, as {tab, id} from the create results.'),
    refs: z.array(z.string()).optional().describe('Alternatively, refs of existing samples to group, e.g. ["SL-8000", "TYPE-980"].'),
    receiver: z.string().optional().describe('Receiver / client name to pick the right send when a ref has several.'),
    client_id: z.string().optional().describe('The client the order goes to (from the create results).'),
    requested_by: z.string().optional().describe('The Sales Trader whose request this is (same as on the creates). Defaults to the person chatting.'),
    logged_by: z.string().optional().describe('Who logged it (same as on the creates). Defaults to the person chatting.'),
    location: z.string().optional().describe('Lab the consignment ships from / sits at — "Westlands" or "Thika".'),
    notes: z.string().optional().describe('Free-text note, e.g. "September dispatch to Beyers".'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const loggedBy = input.logged_by ?? (await currentUserName());
    const requestedBy = input.requested_by ?? loggedBy;
    const samples = [...(input.samples ?? [])];
    let missing: Array<{ ref: string; reason: string }> = [];
    if (input.refs?.length) {
      const resolved = await resolveSamples(input.refs, { receiver: input.receiver });
      samples.push(...resolved.found.map((s) => ({ tab: s.tab, id: s.id })));
      missing = resolved.missing;
    }

    // One transaction on the API: the row plus its members (contracts §6).
    const consignment = await apiFetch('/consignments', {
      method: 'POST',
      body: JSON.stringify({
        location: normalizeLocation(input.location) ?? null,
        notes: input.notes ?? null,
        client_id: input.client_id ?? null,
        requested_by: requestedBy ?? null,
        logged_by: loggedBy ?? null,
        ...(samples.length ? { samples } : {}),
      }),
    });

    return {
      id: consignment.id,
      number: consignment.number,
      client_name: consignment.client_name ?? null,
      location: consignment.location,
      status: consignment.derived_status ?? consignment.status,
      member_count: consignment.member_count ?? samples.length,
      added: samples.length,
      unresolved_refs: missing.map((m) => m.ref),
      ...(missing.length ? { unresolved: missing } : {}),
      url: consignmentUrl(consignment.id, 'created'),
    };
  }
}
