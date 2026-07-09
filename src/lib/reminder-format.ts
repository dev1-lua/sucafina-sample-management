// Shared text formatter for the three reminder jobs. The item shape comes from GET /reminders/:kind
// (see api/src/lib/reminders.ts SELECT list): { tab, id, ref, title, receiver, awb, courier_norm,
// status, created_at, delivery_on }.
export interface ReminderItem {
  tab: string;
  id: string;
  ref: string | null;
  title: string | null;
  receiver: string | null;
  awb: string | null;
  courier_norm: string | null;
  status: string | null;
  created_at: string | null;
  delivery_on: string | null;
}

function fmtItem(i: ReminderItem): string {
  const head = [i.ref || '(no ref)', i.title].filter(Boolean).join(' — ');
  return `• ${head} → ${i.receiver || '?'}`;
}

// `header` is the section title without the count; we append "(N)". The endpoint already caps items
// at 50, but we show at most 15 per nudge and note the overflow so a big backlog stays chat-friendly.
export function formatReminder(header: string, count: number, items: ReminderItem[]): string {
  if (count === 0) return `${header} (0)\n• nothing pending 🎉`;
  const shown = items.slice(0, 15).map(fmtItem);
  if (count > shown.length) shown.push(`…and ${count - shown.length} more`);
  return `${header} (${count})\n${shown.join('\n')}`;
}
