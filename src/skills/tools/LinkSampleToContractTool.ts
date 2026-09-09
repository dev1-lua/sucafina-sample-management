import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { contractsUrl } from '../../lib/links';
import { resolveSampleByRef } from '../../lib/resolve-sample';

const norm = (s: unknown) => String(s ?? '').trim().toUpperCase();

export default class LinkSampleToContractTool implements LuaTool {
  name = 'link_sample_to_contract';
  description =
    'Attach an existing sample to a contract as the pre-shipment sample for one container — for a PSS that was logged before anyone knew its contract. Pass the sample ref and the contract number; the container is picked automatically unless you name one.';

  inputSchema = z.object({
    ref: z.string().min(1).describe('Sample ref, e.g. "SSKE-108291".'),
    contract_number: z.string().min(1).describe('Contract number, e.g. "CT-2026-14".'),
    container_no: z.number().int().min(1).optional().describe('Container this sample covers; omitted, the first free container is used.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const wanted = norm(input.contract_number);
    const list = await apiFetch(`/contracts?q=${encodeURIComponent(input.contract_number.trim())}&pageSize=100`);
    const contract = (list.data ?? []).find((c: any) => norm(c.contract_number) === wanted);
    if (!contract) {
      return { linked: false, message: `No contract ${input.contract_number.trim()} in the book — check the number, or import the SOL schedule.` };
    }

    // Forwarding parcels have no PSS step, so the sample must resolve to Specialty or Commercial.
    const sample = await resolveSampleByRef(input.ref);
    if (sample.tab !== 'specialty' && sample.tab !== 'bulk') {
      return { linked: false, message: `${input.ref.trim()} is a Forwarding parcel — only Specialty and Commercial samples can cover a container.` };
    }

    const res = await apiFetch(`/contracts/${encodeURIComponent(String(contract.id))}/link`, {
      method: 'POST',
      body: JSON.stringify({ tab: sample.tab, sample_id: sample.id, container_no: input.container_no ?? null }),
    });
    return {
      linked: true,
      ref: input.ref.trim(),
      tab: sample.tab,
      contract_number: contract.contract_number,
      container_no: res.container_no,
      url: contractsUrl(String(contract.id)),
    };
  }
}
