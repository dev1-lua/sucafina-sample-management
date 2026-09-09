import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';
import { contractsUrl } from '../../lib/links';

export default class ConfirmPssImportTool implements LuaTool {
  name = 'confirm_pss_import';
  description =
    'Commit a PSS schedule preview from import_pss_schedule: creates/updates the contracts and draws one PSS request per container. Call ONLY after the user has explicitly said yes to the preview. Use overrides to point a row at a specific client, or to skip a row. An import can be committed once.';

  inputSchema = z.object({
    import_id: z.string().min(1).describe('import_id returned by import_pss_schedule.'),
    overrides: z
      .array(
        z.object({
          row_no: z.number().int().min(1).describe('Row number as shown in the preview.'),
          client_id: z.string().optional().describe('Client id to use for this row (from find_client), when the matched client is wrong.'),
          skip: z.boolean().optional().describe('true to leave this row out of the import.'),
        }),
      )
      .optional()
      .describe('Per-row corrections the user asked for. Omit when the preview is accepted as-is.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const res = await apiFetch(`/imports/pss-schedule/${encodeURIComponent(input.import_id)}/commit`, {
      method: 'POST',
      body: JSON.stringify({ overrides: input.overrides ?? [] }),
    });
    return {
      contracts_created: res.contracts_created,
      contracts_updated: res.contracts_updated,
      pss_created: res.pss_created,
      skipped: res.skipped,
      contract_ids: res.contract_ids ?? [],
      contracts_url: contractsUrl(),
    };
  }
}
