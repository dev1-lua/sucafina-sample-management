// PSS schedule harness (Phase 5, Task 5.5): serves the SOL fixture over a throwaway loopback HTTP
// server, then drives the REAL agent tools against a LOCAL API — import_pss_schedule (preview) →
// confirm_pss_import → list_pss_due → get_contract — and renders the four PSS notifier messages.
// Contract and client names are stamped, and everything it creates is deleted at the end. Never prod.
//
// Requires the API started with IMPORT_ALLOWED_HOSTS=localhost,127.0.0.1 (the import download is
// https-only except for a loopback host the allow-list explicitly names).
// Run: npm run harness:pss
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import ImportPssScheduleTool from '../src/skills/tools/ImportPssScheduleTool';
import ConfirmPssImportTool from '../src/skills/tools/ConfirmPssImportTool';
import ListPssDueTool from '../src/skills/tools/ListPssDueTool';
import GetContractTool from '../src/skills/tools/GetContractTool';
import { pssMessage, QC_EVENTS, QC_AND_LOOP_EVENTS } from '../src/jobs/status-notifier.job';
import type { OutboxItem } from '../src/lib/change-alerts';

if (!/localhost|127\.0\.0\.1/.test(process.env.API_BASE_URL ?? '')) {
  throw new Error('Refusing to run: API_BASE_URL must point at a local API');
}
process.env.API_KEY ??= 'dev-key-sucafina';
const BASE = process.env.API_BASE_URL!;
const HDR = { 'content-type': 'application/json', 'x-api-key': process.env.API_KEY!, 'x-actor': 'pss-harness' };
const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...HDR, ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${r.status} ${JSON.stringify(body)}`);
  return body;
};

let failures = 0;
const ok = (label: string, cond: boolean, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
};

const stamp = String(Math.floor(Math.random() * 1e6));
const TAG = `QAPSS${stamp}`;
const num = (n: number) => `CT-${stamp}-${n}`;
const here = dirname(fileURLToPath(import.meta.url));

// The fixture, with every contract number and client name stamped so the run never collides with the
// dev DB's real book and can delete exactly what it made.
const csv = readFileSync(resolve(here, '../api/test/fixtures/sol-pss.csv'), 'utf8')
  .replace(/CT-2026-(\d+)/g, (_m, n: string) => `CT-${stamp}-${n}`)
  .replace(/(^|,)(Paulig|Gustav Paulig Ltd \(NEW\) Jan 23|Nestlé España|Unknown Roasters|Orphan row)(,|$)/gm,
           (_m, pre: string, name: string, post: string) => `${pre}${name} ${TAG}${post}`);

const server = http.createServer((req, res) => {
  if ((req.url ?? '').startsWith('/sol-pss.csv')) {
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8' });
    res.end(csv);
    return;
  }
  res.writeHead(404).end('not found');
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;
const fileUrl = `http://127.0.0.1:${port}/sol-pss.csv`;

const contractIds: string[] = [];
let clientId: string | null = null;

try {
  // ───────────── an exact client match to hit: the first row's buyer, already in the book
  const seeded = await api('/clients', { method: 'POST', body: JSON.stringify({ name: `Paulig ${TAG}` }) });
  clientId = String(seeded.id);

  // ───────────── 1. preview (writes nothing)
  const preview = await new ImportPssScheduleTool().execute({ file_url: fileUrl });
  console.log(`\npreview: ${JSON.stringify(preview.summary)}`);
  console.log(`mapping: ${JSON.stringify(preview.detected_mapping)}`);
  for (const r of preview.rows) {
    console.log(`  row ${r.row_no}: ${r.contract_number ?? '(no number)'} · ${r.client_name ?? '—'} [${r.client_match ?? 'no match'}]` +
      ` ship ${r.shipment_date ?? '—'} (${r.date_precision ?? '—'}) due ${r.pss_due_date ?? '—'} × ${r.pss_options} option(s)${r.grams_per_option ? ` of ${r.grams_per_option} g` : ''} → ${r.action}` +
      `${r.problems.length ? ` PROBLEMS: ${r.problems.join('; ')}` : ''}${r.warnings.length ? ` warn: ${r.warnings.join('; ')}` : ''}`);
  }
  ok('preview returns an import_id', Boolean(preview.import_id), String(preview.import_id));
  ok('preview groups the repeated contract lines', preview.summary.contracts === 4, JSON.stringify(preview.summary));
  ok('preview flags the rows it cannot import', preview.problems_total === 2, `problems_total=${preview.problems_total}`);
  ok('preview caps the rows it shows at 20', preview.rows_shown <= 20 && preview.rows_shown === preview.rows.length, `${preview.rows_shown}/${preview.rows_total}`);
  const first = preview.rows.find((r) => r.contract_number === num(14));
  ok('first contract matched the seeded client exactly', first?.client_match === 'exact', JSON.stringify(first?.client_match));
  ok('PSS due date is 45 days before shipment', first?.shipment_date === '2026-10-20' && first?.pss_due_date === '2026-09-05', `${first?.shipment_date} → ${first?.pss_due_date}`);
  ok('a month-only shipment is flagged, not guessed', preview.rows.some((r) => r.date_precision === 'month' && r.warnings.length > 0), '');
  ok('clients not in the book are listed', preview.unmatched_clients.length >= 2, JSON.stringify(preview.unmatched_clients));

  // ───────────── 2. commit
  const done = await new ConfirmPssImportTool().execute({ import_id: preview.import_id });
  console.log(`\ncommit: ${JSON.stringify(done)}`);
  contractIds.push(...done.contract_ids);
  // Every previewed row is accounted for, and a row the preview flagged is skipped rather than created.
  const clean = preview.rows.filter((r) => r.action === 'create' && r.problems.length === 0).length;
  ok('commit accounts for every previewed row', done.contracts_created + done.contracts_updated + done.skipped === preview.rows_total, JSON.stringify(done));
  ok('commit created only the rows without problems', done.contracts_created === clean && done.contracts_updated === 0, `${done.contracts_created} vs ${clean}`);
  ok('commit drew the PSS the preview promised', done.pss_created === preview.summary.pss_to_create, `${done.pss_created} vs ${preview.summary.pss_to_create}`);
  ok('commit skipped the problem rows', done.skipped === 2, String(done.skipped));
  ok('commit returns the Contracts link', /\/contracts$/.test(done.contracts_url), done.contracts_url);

  // ───────────── 3. what is due
  const due = await new ListPssDueTool().execute({ days: 14 });
  const mine = due.contracts.filter((c) => String(c.contract_number).startsWith(`CT-${stamp}-`));
  console.log(`\npss-due (14d): ${due.count} total, ${mine.length} from this run`);
  for (const c of mine) console.log(`  ${c.contract_number} · ${c.client_name} due ${c.pss_due_date} (${c.days_left}d) • ${c.approved} of ${c.expected} approved • ${c.missing_pss} to send`);
  ok('list_pss_due finds the imported contracts', mine.length >= 2, `${mine.length}`);
  ok('list_pss_due counts what is still to send', mine.every((c) => c.missing_pss === c.expected && c.approved === 0), JSON.stringify(mine.map((c) => c.missing_pss)));
  const noOverdue = await new ListPssDueTool().execute({ days: 14, include_overdue: false });
  ok('include_overdue=false drops the past-due rows', noOverdue.contracts.every((c) => (c.days_left ?? 0) >= 0) && noOverdue.count < due.count, `${noOverdue.count} vs ${due.count}`);

  // ───────────── 4. one contract
  const contract = await new GetContractTool().execute({ contract_number: num(14) });
  console.log(`\nget_contract ${num(14)}: ${JSON.stringify({ status: contract.status, pss: contract.pss, options: (contract.options ?? []).length, url: contract.url })}`);
  const cards: any[] = contract.options ?? [];
  ok('get_contract resolves the number exactly', contract.found === true && contract.contract_number === num(14), String(contract.contract_number));
  ok('get_contract returns one card per option slot', cards.length === 2, JSON.stringify(cards.map((c) => c.state)));
  ok('each slot holds its lettered PSS with a contract-derived ref and a stage', cards.every((c) => c.state === 'pending' && c.samples.length === 1 && /^SSKE-\d+[A-Z]+$/.test(c.samples[0].ref) && /^[A-Z]+$/.test(c.samples[0].option) && c.samples[0].stage === 'Pending PSS dispatch'), JSON.stringify(cards.map((c) => c.samples.map((s: any) => [s.ref, s.option, s.stage]))));
  ok('option letters run A, B across the slots', cards.map((c) => c.samples[0].option).join('') === 'AB', cards.map((c) => c.samples[0].option).join(''));
  ok('get_contract links to the dashboard', /\/contracts\//.test(contract.url ?? ''), contract.url);
  const missing = await new GetContractTool().execute({ contract_number: `CT-${stamp}-NOPE` });
  ok('an unknown number is reported, not invented', missing.found === false, String(missing.message));

  // ───────────── 5. the four notifier messages (pure formatting — touches nothing)
  const nowIso = new Date().toISOString();
  const base = {
    outbox_id: 'fake', sample_id: 'fake-id', recipient: 'qc', title: 'AB FAQ', receiver: 'Finland',
    status: null, courier_norm: null, awb: null, qty_grams: null, priority: null,
    requested_by: null, logged_by: null, created_at: nowIso, recipients: [],
  };
  const items: OutboxItem[] = [
    { ...base, tab: 'contract', event: 'pss_due_soon', ref: num(16), client_name: `Nestlé España ${TAG}`,
      payload: { contract_number: num(16), shipment_date: '2026-11-05', pss_due_date: '2026-09-21', days_left: 7, missing_pss: 2, approved: 0, expected: 2 } },
    { ...base, tab: 'contract', event: 'pss_overdue', ref: num(14), client_name: `Paulig ${TAG}`,
      payload: { contract_number: num(14), shipment_date: '2026-10-20', pss_due_date: '2026-09-05', days_left: -4, overdue_days: 4, missing_pss: 2, approved: 0, expected: 2 } },
    { ...base, tab: 'contract', event: 'pss_rejected', ref: num(14), client_name: `Paulig ${TAG}`,
      payload: { contract_number: num(14), failed_containers: [2], failed_options: ['C'], replacements: ['SSKE-202614D'] } },
    { ...base, tab: 'import', event: 'pss_schedule_imported', ref: 'sol-pss.csv', client_name: null,
      payload: { file_name: 'sol-pss.csv', contracts_created: 3, contracts_updated: 0, pss_created: 5, first_due: '2026-07-18', actor: 'Harriet' } },
  ];
  console.log('');
  for (const i of items) {
    const m = pssMessage(i);
    console.log(`--- ${i.event} ---\nsubject: ${m.subject}\ntext:    ${m.text}`);
  }
  const [soon, over, rej, imp] = items.map(pssMessage);
  ok('due-soon names the countdown, the ship date and what is left', /PSS due in 7 days/.test(soon.text) && /0 of 2 options approved/.test(soon.text) && /2 options still to send/.test(soon.text), soon.text);
  // The ship date on the due-soon fake is 2026-11-05 → "5 Nov 2026" (three letters, no leading zero).
  ok('dates read as "5 Nov 2026"', /ship 5 Nov 2026 /.test(soon.text), soon.text);
  ok('no ICU "Sept" anywhere in the four messages', ![soon, over, rej, imp].some((m) => /Sept/.test(m.text + m.subject)), [soon, over, rej, imp].map((m) => m.text).join(' | ').slice(0, 160));
  ok('overdue leads with how late it is', /PSS OVERDUE 4d/.test(over.text) && over.subject.startsWith('PSS OVERDUE 4d'), over.text);
  ok("a twice-rejected option is Harriet's 'PSS replacement rejected', names the letter and the next draw", /PSS replacement rejected — option C; SSKE-202614D drawn as the next option/.test(rej.text) && /settle with the trader/.test(rej.text), rej.text);
  ok('the import summary counts contracts and options', /5 options scheduled across 3 contracts \(3 new\)/.test(imp.text), imp.text);
  ok('reminders are routed to QC only; the flag still reaches the account manager', QC_EVENTS.has('pss_due_soon') && QC_EVENTS.has('pss_overdue') && !QC_AND_LOOP_EVENTS.has('pss_due_soon') && !QC_AND_LOOP_EVENTS.has('pss_overdue') && QC_AND_LOOP_EVENTS.has('pss_rejected'));
} catch (e: any) {
  failures += 1;
  console.error('❌ harness crashed:', e.stack ?? e.message ?? e);
} finally {
  // Drawn PSS first (they outlive a soft-deleted contract), then the contracts, then the clients.
  for (const id of contractIds) {
    const c = await api(`/contracts/${id}`).catch(() => null);
    for (const container of c?.containers ?? []) {
      for (const s of container.samples ?? []) {
        await api(`/${s.tab === 'specialty' ? 'specialty-samples' : 'bulk-samples'}/${s.id}`, { method: 'DELETE' }).catch(() => undefined);
      }
    }
    await api(`/contracts/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }
  const made = await api(`/clients?q=${encodeURIComponent(TAG)}&pageSize=100`).catch(() => null);
  for (const c of made?.data ?? []) await api(`/clients/${c.id}`, { method: 'DELETE' }).catch(() => undefined);
  if (clientId) await api(`/clients/${clientId}`, { method: 'DELETE' }).catch(() => undefined);
  server.close();
}
console.log(failures ? `\n❌ ${failures} check(s) failed` : '\n✅ all PSS checks passed');
process.exitCode = failures ? 1 : 0;
