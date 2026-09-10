import { LuaTool } from 'lua-cli';
import { z } from 'zod';
import { apiFetch } from '../../lib/api';

/** How many preview rows the model is shown — the rest stay in the stored import, ready for the commit. */
const PREVIEW_LIMIT = 20;

type PreviewRow = {
  row_no: number;
  contract_number: string | null;
  client_name: string | null;
  client_match: { id: string; name: string; kind: string } | null;
  shipment_date: string | null;
  date_precision: string | null;
  pss_due_date: string | null;
  containers: number;
  pss_expected: number;
  pss_qty_grams: number | null;
  po_ref: string | null;
  action: string;
  problems: string[];
  warnings: string[];
};

export default class ImportPssScheduleTool implements LuaTool {
  name = 'import_pss_schedule';
  description =
    'Parse an SOL PSS schedule (xlsx/csv URL) into a preview. NEVER commits — show the preview and wait for an explicit go. Returns the import_id, the summary, the detected column mapping and the first rows, each with the contract, client match, shipment/due dates, PSS options × grams (from "quantity per sample"), PO ref, what it would do (create/update/skip) and any problems or warnings. A PDF is refused: ask for the Excel/CSV export.';

  inputSchema = z.object({
    file_url: z
      .string()
      .min(1)
      .describe('URL of the schedule file the user attached or pasted, e.g. https://cdn.heylua.ai/… (.xlsx or .csv).'),
    sheet: z.string().optional().describe('Sheet name, when the workbook has several and the first is not the schedule.'),
    mapping: z
      .record(z.string())
      .optional()
      .describe('Column corrections as { canonical field: the header it lives under }, e.g. { "shipment_date": "ETD" }. Only when the detected mapping is wrong.'),
    header_row: z.number().int().min(0).max(999).optional().describe('0-based row index of the header line, when the sheet has an unusual preamble.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const res = await apiFetch('/imports/pss-schedule', {
      method: 'POST',
      body: JSON.stringify({
        file_url: input.file_url,
        sheet: input.sheet ?? null,
        mapping: input.mapping ?? null,
        header_row: input.header_row ?? null,
      }),
    });
    const rows: PreviewRow[] = Array.isArray(res.rows) ? res.rows : [];
    return {
      import_id: res.import_id,
      file_name: res.file_name,
      format: res.format,
      sheet: res.sheet,
      sheets: res.sheets ?? [],
      header_row: res.header_row,
      summary: res.summary,
      detected_mapping: res.detected_mapping,
      unmapped_headers: res.unmapped_headers ?? [],
      rows_total: rows.length,
      rows_shown: Math.min(rows.length, PREVIEW_LIMIT),
      rows: rows.slice(0, PREVIEW_LIMIT).map((r) => ({
        row_no: r.row_no,
        contract_number: r.contract_number,
        client_name: r.client_name,
        client_match: r.client_match?.kind ?? null,
        shipment_date: r.shipment_date,
        date_precision: r.date_precision,
        pss_due_date: r.pss_due_date,
        containers: r.containers,
        pss_options: r.pss_expected,
        grams_per_option: r.pss_qty_grams ?? null,
        po_ref: r.po_ref ?? null,
        action: r.action,
        problems: r.problems,
        warnings: r.warnings,
      })),
      problems_total: rows.filter((r) => (r.problems ?? []).length > 0).length,
      unmatched_clients: res.summary?.unmatched_clients ?? [],
    };
  }
}
