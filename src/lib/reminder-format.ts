// Shared text formatter for the three reminder jobs. The item shape comes from GET /reminders/:kind
// (see api/src/lib/reminders.ts SELECT list): { tab, id, ref, title, receiver, awb, courier_norm,
// status, created_at, delivery_on }.
import { refWithSendId } from './normalize';

export interface ReminderItem {
  tab: string;
  id: string;
  ref: string | null;
  /** The row's Send ID (`SS-1234`, round 11) when GET /reminders/:kind carries it — quoted after the ref. */
  send_id?: string | null;
  title: string | null;
  receiver: string | null;
  awb: string | null;
  courier_norm: string | null;
  status: string | null;
  created_at: string | null;
  delivery_on: string | null;
}

// Markdown `- ` bullets (not literal `•`): Teams renders bot messages as markdown, where plain lines
// separated by single \n can collapse into one paragraph — real list items keep their own lines.
function fmtItem(i: ReminderItem): string {
  const head = [refWithSendId(i.ref, i.send_id), i.title].filter(Boolean).join(' — ');
  return `- ${head} → ${i.receiver || '?'}`;
}

// `header` is the section title without the count; we append "(N)". The endpoint already caps items
// at 50, but we show at most 15 per nudge and note the overflow so a big backlog stays chat-friendly.
export function formatReminder(header: string, count: number, items: ReminderItem[]): string {
  if (count === 0) return `**${header} (0)**\n- nothing pending 🎉`;
  const shown = items.slice(0, 15).map(fmtItem);
  if (count > shown.length) shown.push(`- …and ${count - shown.length} more`);
  return `**${header} (${count})**\n${shown.join('\n')}`;
}
