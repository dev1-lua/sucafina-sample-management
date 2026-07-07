import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Client, ListResponse } from '../types';

export default function ClientsPage() {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Client[]>([]);
  const [selected, setSelected] = useState<Client | null>(null);
  const [form, setForm] = useState({ name: '', country: '', attention_to: '', full_address: '', phone: '', email: '' });

  const load = useCallback(() => {
    api<ListResponse<Client>>(`/clients?q=${encodeURIComponent(q)}`).then((r) => setList(r.data)).catch(console.error);
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const open = (id: string) => api<Client>(`/clients/${id}`).then(setSelected).catch(console.error);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const contact = form.attention_to || form.full_address || form.phone || form.email
      ? { attention_to: form.attention_to || null, full_address: form.full_address || null, phone: form.phone || null, email: form.email || null }
      : null;
    await api('/clients', { method: 'POST', body: JSON.stringify({ name: form.name, country: form.country || null, contact }) });
    setForm({ name: '', country: '', attention_to: '', full_address: '', phone: '', email: '' });
    load();
  };

  return (
    <>
      <h2>Clients</h2>
      <div className="filters">
        <input placeholder="Search clients…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Country</th><th>Contacts</th></tr></thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => open(c.id)}>
                <td>{c.name}</td><td>{c.country ?? ''}</td><td>{c.contact_count ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected && (
        <div className="card">
          <h3>{selected.name} {selected.country ? <span className="muted">({selected.country})</span> : null}</h3>
          {selected.contacts?.length ? (
            <ul>
              {selected.contacts.map((ct) => (
                <li key={ct.id}><b>{ct.attention_to ?? '—'}</b> · {ct.full_address ?? ''} · {ct.phone ?? ''} {ct.email ? `· ${ct.email}` : ''}</li>
              ))}
            </ul>
          ) : <p className="muted">no contacts on file</p>}
        </div>
      )}
      <div className="card">
        <h3>Add client / contact</h3>
        <form className="grid" onSubmit={create}>
          <label>company name * <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>country <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></label>
          <label>contact person <input value={form.attention_to} onChange={(e) => setForm({ ...form, attention_to: e.target.value })} /></label>
          <label>address <input value={form.full_address} onChange={(e) => setForm({ ...form, full_address: e.target.value })} /></label>
          <label>phone <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label>email <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <button className="primary">Save</button>
        </form>
      </div>
    </>
  );
}
