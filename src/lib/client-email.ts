// Shared pieces for the two client-facing email jobs (dispatch confirmation +
// 7-day feedback chaser). Plain inline-styled HTML — no external assets, so it
// renders the same in every mail client.

export type DispatchItem = {
  tab: string;
  id: string;
  ref: string | null;
  title: string | null;
  receiver: string | null;
  courier_norm: string | null;
  awb: string | null;
  qty_grams: number | null;
  dispatched_on: string | null;
  client_name: string;
  email: string;
};

export type FeedbackItem = {
  tab: string;
  id: string;
  ref: string | null;
  title: string | null;
  delivery_on: string | null;
  client_name: string;
  email: string;
};

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function qtyText(grams: number | null): string {
  if (typeof grams !== 'number') return '';
  return grams >= 1000 ? ` (${grams / 1000} kg)` : ` (${grams} g)`;
}

const FOOTER =
  '<p style="margin:16px 0 0;color:#6b7280;font-size:13px">— Sucafina Sample Desk, Nairobi<br>Just reply to this email with any questions.</p>';

const WRAP = (inner: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;line-height:1.5;max-width:560px">${inner}${FOOTER}</div>`;

/** One shipment (same client email + AWB) → one email listing every ref on it. */
export function dispatchEmail(items: DispatchItem[]) {
  const first = items[0]!;
  const courier = first.courier_norm ? first.courier_norm.replace(/_/g, ' ').toUpperCase() : null;
  const refs = items.map((i) => i.ref).filter(Boolean);
  const subject = `Your Sucafina samples are on the way${courier ? ` — ${courier}` : ''}${first.awb ? ` ${first.awb}` : ''}`;
  const rows = items
    .map((i) => `<li style="margin:2px 0"><strong>${esc(i.ref ?? '(no ref)')}</strong> — ${esc(i.title ?? '')}${qtyText(i.qty_grams)}</li>`)
    .join('');
  const html = WRAP(
    `<p>Hello ${esc(first.client_name)},</p>
     <p>The following sample${items.length === 1 ? ' was' : 's were'} dispatched from our Nairobi sample room:</p>
     <ul style="padding-left:18px;margin:8px 0">${rows}</ul>
     <p style="margin:8px 0">${courier ? `Courier: <strong>${esc(courier)}</strong>` : 'Courier: to be confirmed'}${first.awb ? ` &middot; Tracking/AWB: <strong>${esc(first.awb)}</strong>` : ''}</p>`,
  );
  return { subject, html, refs };
}

/** One client → one chaser listing every sample awaiting their feedback. */
export function feedbackChaserEmail(items: FeedbackItem[]) {
  const first = items[0]!;
  const refs = items.map((i) => i.ref).filter(Boolean);
  const subject = `How did the samples cup?${refs.length ? ` — ${refs.slice(0, 3).join(', ')}${refs.length > 3 ? '…' : ''}` : ''}`;
  const rows = items
    .map((i) => `<li style="margin:2px 0"><strong>${esc(i.ref ?? '(no ref)')}</strong> — ${esc(i.title ?? '')}${i.delivery_on ? ` (delivered ${esc(String(i.delivery_on).slice(0, 10))})` : ''}</li>`)
    .join('');
  const html = WRAP(
    `<p>Hello ${esc(first.client_name)},</p>
     <p>A quick follow-up on the sample${items.length === 1 ? '' : 's'} we sent — we'd love your cupping feedback:</p>
     <ul style="padding-left:18px;margin:8px 0">${rows}</ul>
     <p>A one-line reply is perfect — approved / rejected, and any notes on the cup.</p>`,
  );
  return { subject, html, refs };
}

export function groupBy<T>(items: T[], key: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(item);
  }
  return [...groups.values()];
}
