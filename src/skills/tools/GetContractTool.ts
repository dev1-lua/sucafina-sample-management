import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { contractsUrl } from '../../lib/links';

type PssCounts = { expected: number; approved: number; rejected: number; pending: number };

const norm = (s: unknown) => String(s ?? '').trim().toUpperCase();

export default class GetContractTool implements LuaTool {
  name = 'get_contract';
  description =
    'Get one contract by its number: client, quality, destination, shipment + PSS due date, status, and every container with the pre-shipment samples drawn for it (ref, status, result, dispatch, replacements). Use for "where are we on CT-2026-14", "has Paulig approved their PSS".';

  inputSchema = z.object({
    contract_number: z.string().min(1).describe('Contract number as written, e.g. "CT-2026-14".'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const wanted = norm(input.contract_number);
    const list = await apiFetch(`/contracts?q=${encodeURIComponent(input.contract_number.trim())}&pageSize=100`);
    const hit = (list.data ?? []).find((c: any) => norm(c.contract_number) === wanted);
    if (!hit) {
      return {
        found: false,
        message: `No contract ${input.contract_number.trim()} in the book — check the number, or import the SOL schedule.`,
        near_matches: (list.data ?? []).slice(0, 5).map((c: any) => c.contract_number),
      };
    }

    const c = await apiFetch(`/contracts/${encodeURIComponent(String(hit.id))}`);
    const counts = (c.pss_counts ?? {}) as PssCounts;
    // NB: on the detail response `containers` is the per-container array (it shadows the row's count
    // column) — the number of containers comes off the list row.
    const containers: any[] = Array.isArray(c.containers) ? c.containers : [];
    return {
      found: true,
      id: String(c.id),
      contract_number: c.contract_number,
      client: c.client ? { id: c.client.id, name: c.client.name, account_owner: c.client.account_owner?.name ?? null } : null,
      client_name: c.client_name,
      quality: c.quality,
      destination: c.destination,
      shipment_date: c.shipment_date,
      shipment_month: c.shipment_month,
      pss_due_date: c.pss_due_date,
      status: c.status,
      containers_total: hit.containers,
      pss: { expected: counts.expected, approved: counts.approved, rejected: counts.rejected, pending: counts.pending },
      containers: containers.map((ct: any) => ({
        container_no: ct.container_no,
        state: ct.state,
        samples: (ct.samples ?? []).map((s: any) => ({
          tab: s.tab,
          ref: s.ref,
          status: s.status,
          result: s.result_norm,
          awb: s.awb,
          dispatched_on: s.dispatched_on,
          result_on: s.result_on,
          replaces_sample_id: s.replaces_sample_id,
        })),
      })),
      unassigned: (c.unassigned ?? []).map((s: any) => ({ tab: s.tab, ref: s.ref, status: s.status, result: s.result_norm })),
      notes: c.notes,
      url: contractsUrl(String(c.id)),
    };
  }
}
