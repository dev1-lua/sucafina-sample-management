// Ops for the assistant-feedback module (what colleagues say about the BOT — src/lib/assistant-feedback).
// Talks to the agent's Lua Data collections with your `lua auth` credentials; run from the repo root
// (the SDK reads the agent id from lua.skill.yaml):
//
//   npx tsx scripts/assistant-feedback.mts status                       flag state (read-only)
//   npx tsx scripts/assistant-feedback.mts allow ivo@sucafina.com,…     pilot allowlist (emails)
//   npx tsx scripts/assistant-feedback.mts on | off                     everyone | dark
//   npx tsx scripts/assistant-feedback.mts readstate                    every session + entry (read-only)
//   npx tsx scripts/assistant-feedback.mts repush <session_id>          POST one closed session to the Sheet
//   npx tsx scripts/assistant-feedback.mts repush <session_id> --mark-unpushed
//                                                                       only sets sheet_pushed:false (arms the sweeper retry test)
//   npx tsx scripts/assistant-feedback.mts cleanup-tests <email>        delete that sender's sessions + entries
//
// The flag value the runtime recognizes (state.ts parseFeedbackAccess): true → everyone; an array of
// emails → pilot; anything else → DARK by design (typos fail off). Clean out test sessions before `on`:
// the nightly sweeper mirrors every closed session to the client-readable Sheet, flag or no flag.
// `repush` is safe to run twice — the Apps Script dedupes on session_id.
import { readFileSync } from 'node:fs';
import { Data } from 'lua-cli';
import { normalizeAccessEntry, parseFeedbackAccess } from '../src/lib/assistant-feedback/state';
import { buildSheetPayload, interpretSheetResponse } from '../src/lib/assistant-feedback/sheet-push';
import { CONFIG, ENTRIES, FLAG_KEY, SESSIONS } from '../src/lib/assistant-feedback/store';

const env: Record<string, string> = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const [cmd, ...args] = process.argv.slice(2);

const describe = (value: unknown) => {
  const a = parseFeedbackAccess(value);
  return a.mode === 'all' ? 'ON for everyone' : a.mode === 'allowlist' ? `ALLOWLIST (${a.allow.length}): ${a.allow.join(', ')}` : 'DARK';
};

async function all(collection: string, filter: Record<string, string> = {}) {
  const out: Array<{ id: string; data: any }> = [];
  for (let page = 1; page <= 20; page++) {
    const res = await Data.get(collection, filter, page, 100);
    for (const r of res.data) out.push({ id: r.id, data: r.data });
    if (res.data.length < 100) break;
  }
  return out;
}

if (cmd === 'status' || cmd === 'on' || cmd === 'off' || cmd === 'allow') {
  const existing = (await all(CONFIG, { key: FLAG_KEY }))[0] ?? null;
  console.log('BEFORE:', describe(existing?.data?.value), existing ? `(row ${existing.id})` : '(no row)');
  if (cmd !== 'status') {
    let value: boolean | string[] = cmd === 'on';
    if (cmd === 'allow') {
      value = (args[0] ?? '').split(',').map(normalizeAccessEntry).filter((e, i, a) => e.includes('@') && a.indexOf(e) === i);
      if (value.length === 0) throw new Error('allow needs a comma-separated list of emails');
    }
    if (existing) await Data.update(CONFIG, existing.id, { key: FLAG_KEY, value });
    else await Data.create(CONFIG, { key: FLAG_KEY, value });
    const after = (await all(CONFIG, { key: FLAG_KEY }))[0];
    console.log('AFTER: ', describe(after?.data?.value), `(row ${after?.id})`);
  }
} else if (cmd === 'readstate') {
  const sessions = await all(SESSIONS);
  console.log('SESSIONS', sessions.length);
  for (const r of sessions) console.log(JSON.stringify({ id: r.id, ...r.data }));
  const entries = await all(ENTRIES);
  console.log('ENTRIES', entries.length);
  for (const r of entries) console.log(JSON.stringify({ id: r.id, ...r.data }));
} else if (cmd === 'repush') {
  const sessionId = args.find((a) => !a.startsWith('--'));
  if (!sessionId) throw new Error('repush needs a session_id (fb-YYYYMMDD-xxxxxx)');
  const rows = await all(SESSIONS, { session_id: sessionId });
  if (rows.length === 0) throw new Error(`no session row for ${sessionId}`);
  const row = rows[0];
  console.log('session:', JSON.stringify({ id: row.id, status: row.data.status, sheet_pushed: row.data.sheet_pushed, email: row.data.email }));
  if (args.includes('--mark-unpushed')) {
    await Data.update(SESSIONS, row.id, { ...row.data, sheet_pushed: false, sheet_push_error: null });
    console.log('marked sheet_pushed:false — the nightly sweeper will retry. No POST sent.');
  } else {
    const entries = (await all(ENTRIES, { session_id: sessionId })).map((r) => r.data).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    if (entries.length === 0) throw new Error('session has zero entries — nothing to push');
    const payload = buildSheetPayload(row.data, entries);
    console.log('payload (no secret):', JSON.stringify(payload, null, 2));
    const url = env.FEEDBACK_SHEET_WEBHOOK_URL;
    const secret = env.FEEDBACK_SHEET_SECRET;
    if (!url || !secret) throw new Error('FEEDBACK_SHEET_WEBHOOK_URL / FEEDBACK_SHEET_SECRET missing from .env');
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, ...payload }), redirect: 'follow' });
    const verdict = interpretSheetResponse(res.status, await res.text());
    console.log('result:', JSON.stringify(verdict));
    if (verdict.ok) await Data.update(SESSIONS, row.id, { ...row.data, sheet_pushed: true, sheet_push_error: null });
  }
} else if (cmd === 'cleanup-tests') {
  const email = normalizeAccessEntry(args[0] ?? '');
  if (!email.includes('@')) throw new Error('cleanup-tests needs the test sender email — it deletes ONLY that sender\'s rows');
  const sessions = await all(SESSIONS, { email });
  for (const s of sessions) {
    for (const e of await all(ENTRIES, { session_id: s.data.session_id })) await Data.delete(ENTRIES, e.id);
    await Data.delete(SESSIONS, s.id);
    console.log(`deleted ${s.data.session_id} (${s.data.status}, pushed=${s.data.sheet_pushed})`);
  }
  console.log(`done — ${sessions.length} session(s) removed. Rows already mirrored stay in the Sheet; delete those by hand.`);
} else {
  console.log('usage: status | on | off | allow <emails> | readstate | repush <session_id> [--mark-unpushed] | cleanup-tests <email>');
}
