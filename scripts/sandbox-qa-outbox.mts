// Sandbox QA helper: look at / silence the outbox rows of QA test samples so no real person is pinged,
// and soft-delete the test rows at the end. Reads API_BASE_URL + API_KEY from the repo .env.
import { readFileSync } from 'node:fs';

const env: Record<string, string> = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const BASE = env.API_BASE_URL;
const HDR = { 'content-type': 'application/json', 'x-api-key': env.API_KEY, 'x-actor': 'script:sandbox-qa-2026-09-14' };
const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { ...HDR, ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${r.status} ${JSON.stringify(body)}`);
  return body;
};

const [cmd, ...args] = process.argv.slice(2);
const needle = args[0] ?? 'QA Sketch';

if (cmd === 'find') {
  // Every sample whose receiver/title carries the QA marker, across the three books.
  const res = await api(`/search?q=${encodeURIComponent(needle)}&pageSize=100`);
  for (const r of res.data) console.log(`${r.tab}\t${r.id}\t${r.ref}\t${r.title}\t${r.receiver}\t${r.status}\tawb=${r.awb ?? '-'}\tawaiting=${r.awaiting_collection ?? 'n/a'}\taddr_missing=${r.client_address_missing}`);
  const clients = await api(`/clients?q=${encodeURIComponent(needle)}&pageSize=100`);
  for (const c of clients.data) console.log(`client\t${c.id}\t${c.name}\taddress_missing=${c.address_missing}`);
} else if (cmd === 'outbox') {
  const res = await api('/notifications/outbox-pending');
  const mine = res.items.filter((i: any) => `${i.receiver ?? ''} ${i.title ?? ''} ${i.client_name ?? ''}`.includes(needle));
  for (const i of mine) console.log(`${i.outbox_id}\t${i.event}\t${i.ref}\t${i.client_name}\trecipients=${JSON.stringify(i.recipients)}\treq=${i.requested_by}\tlog=${i.logged_by}`);
  console.log(`${mine.length} pending rows for "${needle}" (of ${res.items.length} pending overall)`);
} else if (cmd === 'silence') {
  // Mark the QA rows as handled so the notifier never sends them to a real person.
  const res = await api('/notifications/outbox-pending');
  const mine = res.items.filter((i: any) => `${i.receiver ?? ''} ${i.title ?? ''} ${i.client_name ?? ''}`.includes(needle));
  for (const i of mine) {
    await api('/notifications/outbox-mark', { method: 'POST', body: JSON.stringify({ id: i.outbox_id, via: 'email', detail: 'sandbox QA 2026-09-14 — test row, ping suppressed (not sent)' }) });
    console.log(`silenced ${i.event} for ${i.ref}`);
  }
} else if (cmd === 'cleanup') {
  const res = await api(`/search?q=${encodeURIComponent(needle)}&pageSize=100`);
  for (const r of res.data) {
    const ep = r.tab === 'bulk' ? 'bulk-samples' : r.tab === 'specialty' ? 'specialty-samples' : 'forwarding-samples';
    await api(`/${ep}/${r.id}`, { method: 'DELETE' });
    console.log(`deleted ${r.ref} (${r.tab})`);
  }
  const clients = await api(`/clients?q=${encodeURIComponent(needle)}&pageSize=100`);
  for (const c of clients.data) { await api(`/clients/${c.id}`, { method: 'DELETE' }); console.log(`deleted client ${c.name}`); }
} else {
  console.log('usage: qa-outbox.ts find|outbox|silence|cleanup [needle]');
}
